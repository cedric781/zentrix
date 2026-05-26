import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { transferUsdcOnChain, TransferUsdcError } from "@/lib/solana/transfer";
import {
  recordTransaction,
  getUserAccount,
  releaseBalance,
} from "@/lib/ledger";
import { getOrCreateBetEscrowAccount } from "@/lib/bets/escrow";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const MAX_RETRIES = 10;
const STALE_CLAIM_MS = 5 * 60 * 1000;
const WORKER_ID_PREFIX = "escrow-deposits-cron";

function computeNextRetry(retryCount: number): Date {
  const seconds = Math.min(3600, Math.max(30, 2 ** retryCount * 15));
  return new Date(Date.now() + seconds * 1000);
}

export type CreatorDepositOutcome =
  | { outcome: "confirmed"; betId: string; txSignature: string }
  | { outcome: "failed"; betId: string; reason: string; retryCount: number }
  | { outcome: "failed_terminal"; betId: string; reason: string }
  | { outcome: "skipped"; betId: string; reason: string };

export async function processCreatorDeposit(bet: {
  id: string;
  createdById: string;
  stakeUnits: bigint;
  escrowDepositRetryCount: number;
  escrowDepositCreatorTxSig: string | null;
}): Promise<CreatorDepositOutcome> {
  const workerId = `${WORKER_ID_PREFIX}:${crypto.randomUUID().substring(0, 8)}`;
  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS);

  const claim = await prisma.bet.updateMany({
    where: {
      id: bet.id,
      escrowDepositStatus: { in: ["PENDING_CREATOR", "FAILED"] },
      OR: [
        { escrowDepositProcessingAt: null },
        { escrowDepositProcessingAt: { lt: staleThreshold } },
      ],
    },
    data: {
      escrowDepositProcessingAt: new Date(),
      escrowDepositProcessingBy: workerId,
    },
  });

  if (claim.count !== 1) {
    return { outcome: "skipped", betId: bet.id, reason: "claim lock failed" };
  }

  // Orphan recovery: chain TX already confirmed, only ledger commit needed.
  let txSignature: string;
  if (bet.escrowDepositCreatorTxSig) {
    txSignature = bet.escrowDepositCreatorTxSig;
  } else {
    const user = await prisma.user.findUnique({
      where: { id: bet.createdById },
      select: { embeddedWalletAddress: true, walletDelegatedAt: true },
    });

    if (!user?.embeddedWalletAddress || !user.walletDelegatedAt) {
      return await markTerminal(
        bet.id,
        bet.createdById,
        bet.stakeUnits,
        `creator wallet not delegated (address=${!!user?.embeddedWalletAddress}, delegated=${!!user?.walletDelegatedAt})`,
      );
    }

    try {
      const result = await transferUsdcOnChain({
        fromWalletAddress: user.embeddedWalletAddress,
        toWalletAddress: getEnv().ESCROW_WALLET_ADDRESS,
        amountUnits: bet.stakeUnits,
        contextLabel: `escrow-creator:${bet.id}`,
      });
      txSignature = result.txSignature;
    } catch (err) {
      return await markRetryOrTerminal(bet, err);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const creatorAccount = await getUserAccount(tx, bet.createdById);
      await releaseBalance(tx, creatorAccount.id, bet.stakeUnits);

      const escrowAccount = await getOrCreateBetEscrowAccount(tx, bet.id);
      await recordTransaction({
        tx,
        idempotencyKey: `escrow-creator:${bet.id}`,
        description: `Escrow creator deposit (bet=${bet.id})`,
        initiatorUserId: bet.createdById,
        refType: "bet",
        refId: bet.id,
        lines: [
          {
            debitAccountId: creatorAccount.id,
            creditAccountId: escrowAccount.id,
            amountUnits: bet.stakeUnits,
            entryType: "ESCROW_LOCK",
            note: `escrow-creator:${bet.id}`,
          },
        ],
      });

      await tx.bet.update({
        where: { id: bet.id },
        data: {
          status: "OPEN",
          escrowDepositCreatorTxSig: txSignature,
          escrowDepositLastError: null,
          escrowDepositProcessingAt: null,
          escrowDepositProcessingBy: null,
          version: { increment: 1 },
        },
      });

      await tx.betStateTransition.create({
        data: {
          betId: bet.id,
          fromStatus: "PENDING_ESCROW",
          toStatus: "OPEN",
          actorId: null,
          actorType: "SYSTEM_CRON",
          metadata: { txSignature, source: WORKER_ID_PREFIX },
        },
      });
    });

    logger.info(
      { betId: bet.id, txSignature },
      "escrow creator deposit confirmed + bet promoted to OPEN",
    );

    return { outcome: "confirmed", betId: bet.id, txSignature };
  } catch (err) {
    logger.error(
      { betId: bet.id, txSignature, err: err instanceof Error ? err.message : String(err) },
      "POST-TX LEDGER COMMIT FAILED — on-chain funds in escrow but ledger not updated",
    );
    await prisma.bet.update({
      where: { id: bet.id },
      data: {
        escrowDepositCreatorTxSig: txSignature,
        escrowDepositLastError: `LEDGER_COMMIT_FAILED: ${err instanceof Error ? err.message : String(err)}`.substring(0, 500),
        escrowDepositStatus: "FAILED",
        escrowDepositRetryCount: { increment: 1 },
        escrowDepositNextRetryAt: computeNextRetry(bet.escrowDepositRetryCount + 1),
        escrowDepositProcessingAt: null,
        escrowDepositProcessingBy: null,
      },
    });
    return {
      outcome: "failed",
      betId: bet.id,
      reason: "ledger commit failed post-chain",
      retryCount: bet.escrowDepositRetryCount + 1,
    };
  }
}

async function markRetryOrTerminal(
  bet: { id: string; createdById: string; stakeUnits: bigint; escrowDepositRetryCount: number },
  err: unknown,
): Promise<CreatorDepositOutcome> {
  const nextCount = bet.escrowDepositRetryCount + 1;
  const reason = err instanceof TransferUsdcError
    ? `${err.code}: ${err.message}`
    : err instanceof Error
      ? err.message
      : String(err);

  if (nextCount >= MAX_RETRIES) {
    return await markTerminal(bet.id, bet.createdById, bet.stakeUnits, `max retries: ${reason}`);
  }

  await prisma.bet.update({
    where: { id: bet.id },
    data: {
      escrowDepositStatus: "FAILED",
      escrowDepositLastError: reason.substring(0, 500),
      escrowDepositRetryCount: { increment: 1 },
      escrowDepositNextRetryAt: computeNextRetry(nextCount),
      escrowDepositProcessingAt: null,
      escrowDepositProcessingBy: null,
    },
  });

  logger.warn(
    { betId: bet.id, retryCount: nextCount, reason },
    "escrow creator deposit failed, scheduled retry",
  );

  return { outcome: "failed", betId: bet.id, reason, retryCount: nextCount };
}

async function markTerminal(
  betId: string,
  userId: string,
  stakeUnits: bigint,
  reason: string,
): Promise<CreatorDepositOutcome> {
  await prisma.$transaction(async (tx) => {
    const account = await getUserAccount(tx, userId);
    await releaseBalance(tx, account.id, stakeUnits);

    const cancelResult = await tx.bet.updateMany({
      where: {
        id: betId,
        status: { in: ["PENDING_ESCROW", "DRAFT"] },
      },
      data: {
        status: "CANCELLED",
        escrowDepositStatus: "FAILED_TERMINAL",
        escrowDepositLastError: reason.substring(0, 500),
        escrowDepositProcessingAt: null,
        escrowDepositProcessingBy: null,
        version: { increment: 1 },
      },
    });
    if (cancelResult.count !== 1) {
      throw new Error(`markTerminal: bet ${betId} not in cancelable state`);
    }

    await tx.betStateTransition.create({
      data: {
        betId,
        fromStatus: "PENDING_ESCROW",
        toStatus: "CANCELLED",
        actorId: null,
        actorType: "SYSTEM_CRON",
        metadata: { reason, source: `${WORKER_ID_PREFIX}-terminal` },
      },
    });
  });

  logger.error({ betId, reason }, "escrow creator deposit FAILED_TERMINAL — bet auto-cancelled");

  return { outcome: "failed_terminal", betId, reason };
}
