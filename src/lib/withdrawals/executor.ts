import "server-only";
import {
  Transaction,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { parseSolanaAddress } from "@/lib/solana/address";
import { getPrivyServerClient } from "@/lib/privy/server";
import { getEnv } from "@/lib/env";
import {
  recordTransaction,
  getUserAccount,
  getExternalAccount,
  type LedgerLine,
} from "@/lib/ledger";
import { logger } from "@/lib/logger";
import { isCircuitOpen } from "@/lib/circuit-breaker";

export interface ExecuteResult {
  withdrawalId: string;
  outcome: "submitted" | "confirmed" | "failed" | "skipped";
  txSignature?: string;
  reason?: string;
}

/**
 * Drain all QUEUED withdrawals — submit each to Solana via Privy delegated
 * signing. On RPC/sign failure: mark FAILED + create reversal ledger entry.
 *
 * Concurrency: optimistic version locking on Withdrawal row. We claim a row
 * by `UPDATE ... WHERE id=X AND version=V` — if rowsAffected=0, another
 * worker grabbed it. Skip and continue.
 *
 * NEVER throw upstream. Every failure path either retries (transient RPC)
 * or transitions to FAILED with reversal (permanent).
 */
export async function executePendingWithdrawals(opts?: {
  limit?: number;
}): Promise<ExecuteResult[]> {
  // If recon (or an operator) tripped the withdrawals breaker, do not drain
  // QUEUED rows on-chain. The intake gate already blocks new entries; this
  // gate prevents already-queued items from going out while we investigate.
  if (await isCircuitOpen("withdrawals")) {
    logger.warn("executor skipped: withdrawals circuit breaker open");
    return [];
  }

  const limit = opts?.limit ?? 10;
  const queued = await prisma.withdrawal.findMany({
    where: { status: "QUEUED" },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const results: ExecuteResult[] = [];
  for (const w of queued) {
    results.push(await executeOne(w));
  }
  return results;
}

async function executeOne(w: {
  id: string;
  userId: string;
  toAddress: string;
  amountUnits: bigint;
  feeUnits: bigint;
  version: number;
  ledgerTxId: string | null;
}): Promise<ExecuteResult> {
  const env = getEnv();
  const conn = getSolanaConnection();
  const privy = getPrivyServerClient();

  // ── Claim row: optimistic lock via version bump ───────────────────────
  const claim = await prisma.withdrawal.updateMany({
    where: { id: w.id, status: "QUEUED", version: w.version },
    data: { status: "SUBMITTED", version: w.version + 1, submittedAt: new Date() },
  });
  if (claim.count === 0) {
    return { withdrawalId: w.id, outcome: "skipped", reason: "lost claim race" };
  }

  // From here, we OWN this withdrawal. Any failure path must transition it to
  // FAILED + reversal. No silent drops.

  try {
    // ── Resolve user's embedded wallet ──────────────────────────────────
    const user = await prisma.user.findUnique({ where: { id: w.userId } });
    if (!user || !user.embeddedWalletAddress) {
      // TODO #1's auth backfill makes this rare, but a brand-new user whose
      // wallet is still being provisioned can land here. Treat as terminal
      // for this attempt — reversal credits them back; they can retry later.
      return await markFailed(w, "WALLET_NOT_DELEGATED: user has no embedded wallet");
    }

    // Re-validate destination address (defense in depth — shouldn't fail since
    // intake validated, but if a DB row was forged or migration corrupted it,
    // this catches it before the chain does).
    let toPk: PublicKey;
    try {
      toPk = parseSolanaAddress(w.toAddress);
    } catch (err) {
      return await markFailed(w, `address re-validation failed: ${(err as Error).message}`);
    }

    const fromPk = parseSolanaAddress(user.embeddedWalletAddress);
    const usdcMint = parseSolanaAddress(env.USDC_MINT_ADDRESS);

    const fromAta = getAssociatedTokenAddressSync(usdcMint, fromPk, true);
    const toAta = getAssociatedTokenAddressSync(usdcMint, toPk, true);

    // ── Build SPL TransferChecked ───────────────────────────────────────
    const netUnits = w.amountUnits - w.feeUnits;
    const ix: TransactionInstruction = createTransferCheckedInstruction(
      fromAta,
      usdcMint,
      toAta,
      fromPk,
      netUnits,
      6, // USDC decimals
    );

    const tx = new Transaction().add(ix);
    tx.feePayer = fromPk;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;

    // ── Sign + broadcast via Privy delegated signing ────────────────────
    // TODO fase 3: migrate to walletId variant when Privy server-auth v2 stabilizes
    // address-variant is currently @deprecated but still functional
    const result = await privy.walletApi.solana.signAndSendTransaction({
      address: user.embeddedWalletAddress,
      chainType: "solana",
      transaction: tx,
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // mainnet caip-2
    });
    const txSignature = result.hash;

    // ── Wait for confirmation ───────────────────────────────────────────
    const confirmation = await conn.confirmTransaction(
      { signature: txSignature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (confirmation.value.err) {
      return await markFailed(w, `chain rejected: ${JSON.stringify(confirmation.value.err)}`);
    }

    // ── Mark CONFIRMED — bump version again ─────────────────────────────
    await prisma.withdrawal.update({
      where: { id: w.id },
      data: {
        status: "CONFIRMED",
        version: { increment: 1 },
        txSignature,
        confirmedAt: new Date(),
      },
    });

    logger.info({ withdrawalId: w.id, txSignature }, "withdrawal confirmed");
    return { withdrawalId: w.id, outcome: "confirmed", txSignature };
  } catch (err) {
    return await markFailed(w, (err as Error).message);
  }
}

/**
 * Transition Withdrawal to FAILED and create a reversal ledger entry.
 * The reversal credits the user back the full amount (including fee — we do
 * not charge fees on failures).
 *
 * Idempotent on `withdrawal-reversal:<id>` key.
 */
async function markFailed(
  w: { id: string; userId: string; amountUnits: bigint; feeUnits: bigint },
  reason: string,
): Promise<ExecuteResult> {
  logger.error({ withdrawalId: w.id, reason }, "withdrawal failed");

  await prisma.$transaction(async (tx) => {
    // Reverse the debit: external → user (full amount including fee)
    const userAcct = await getUserAccount(tx, w.userId);
    const ext = await getExternalAccount(tx);
    // The fee went to treasury; on failure, we also reverse that.
    const treasury = await tx.financialAccount.findUniqueOrThrow({
      where: { scopeKey: "treasury" },
    });

    const lines: LedgerLine[] = [
      {
        debitAccountId: ext.id,
        creditAccountId: userAcct.id,
        amountUnits: w.amountUnits - w.feeUnits, // net portion
        entryType: "WITHDRAWAL_REVERSAL",
        note: `Withdrawal ${w.id} reversal (net)`,
      },
    ];
    if (w.feeUnits > 0n) {
      lines.push({
        debitAccountId: treasury.id,
        creditAccountId: userAcct.id,
        amountUnits: w.feeUnits,
        entryType: "WITHDRAWAL_REVERSAL",
        note: `Withdrawal ${w.id} fee reversal`,
      });
    }

    const reversal = await recordTransaction({
      tx,
      idempotencyKey: `withdrawal-reversal:${w.id}`,
      description: `Reversal for failed withdrawal ${w.id}`,
      initiatorUserId: w.userId,
      refType: "withdrawal-reversal",
      refId: w.id,
      lines,
    });

    await tx.withdrawal.update({
      where: { id: w.id },
      data: {
        status: "FAILED",
        version: { increment: 1 },
        failReason: reason.slice(0, 500),
        reversalLedgerTxId: reversal.transaction.id,
      },
    });
  });

  return { withdrawalId: w.id, outcome: "failed", reason };
}
