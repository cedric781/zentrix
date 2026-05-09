import "server-only";
import type { Bet } from "@prisma/client";
import { applyBps, FEES } from "@/lib/fees";
import {
  recordTransaction,
  getUserAccount,
  getTreasuryAccount,
  type TxClient,
} from "@/lib/ledger";
import { getOrCreateBetEscrowAccount } from "./escrow";
import { BetError } from "./errors";

export interface SettleBetInput {
  bet: Bet;
  winnerId: string;
  ledgerIdempotencyKey: string;
  fromStatus: "RESULT_PROPOSED" | "DISPUTED" | "ACTIVE";
  actorId: string | null;
}

export async function settleBet(
  tx: TxClient,
  input: SettleBetInput,
): Promise<Bet> {
  const { bet, winnerId, ledgerIdempotencyKey, fromStatus, actorId } = input;

  if (winnerId !== bet.createdById && winnerId !== bet.opponentUserId) {
    throw new BetError(
      "BET_INVALID_INPUT",
      "winnerId must be a bet participant",
      400,
    );
  }

  const potUnits = bet.stakeUnits * 2n;
  const feeUnits = applyBps(potUnits, FEES.PLATFORM_BPS);
  const winnerPayout = potUnits - feeUnits;

  const winnerAcct = await getUserAccount(tx, winnerId);
  const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);
  const treasuryAcct = await getTreasuryAccount(tx);

  const ledgerResult = await recordTransaction({
    tx,
    idempotencyKey: ledgerIdempotencyKey,
    description: `Bet settlement (bet=${bet.id})`,
    initiatorUserId: actorId ?? winnerId,
    refType: "bet",
    refId: bet.id,
    lines: [
      {
        debitAccountId: escrowAcct.id,
        creditAccountId: winnerAcct.id,
        amountUnits: winnerPayout,
        entryType: "SETTLEMENT_PAYOUT",
        note: `bet-settle-payout:${bet.id}`,
      },
      {
        debitAccountId: escrowAcct.id,
        creditAccountId: treasuryAcct.id,
        amountUnits: feeUnits,
        entryType: "FEE_COLLECTION",
        note: `bet-settle-fee:${bet.id}`,
      },
    ],
  });

  const updated = await tx.bet.updateMany({
    where: { id: bet.id, version: bet.version, status: fromStatus },
    data: {
      status: "SETTLED",
      resultStatus: "CONFIRMED",
      winnerId,
      settledAt: new Date(),
      version: bet.version + 1,
    },
  });
  if (updated.count !== 1) {
    throw new BetError(
      "BET_VERSION_MISMATCH",
      `Bet ${bet.id} concurrently mutated during settlement`,
      409,
    );
  }

  let actorType: string;
  if (fromStatus === "ACTIVE" && actorId !== null) {
    actorType = "POOL_CREATOR_RESOLVE";
  } else if (actorId === null) {
    actorType = "SYSTEM";
  } else {
    actorType = "USER";
  }

  await tx.betStateTransition.create({
    data: {
      betId: bet.id,
      fromStatus,
      toStatus: "SETTLED",
      actorId,
      actorType,
      metadata: {
        ledgerTxId: ledgerResult.transaction.id,
        winnerPayout: winnerPayout.toString(),
        feeUnits: feeUnits.toString(),
      },
    },
  });

  return await tx.bet.findUniqueOrThrow({ where: { id: bet.id } });
}
