import "server-only";
import crypto from "node:crypto";
import type { OnChainPayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transferUsdcOnChain, TransferUsdcError } from "@/lib/solana/transfer";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

// ── Tuning ───────────────────────────────────────────────────────────
// Mirrors escrow-deposits/processor.ts so the two on-chain workers share
// the same retry/claim semantics.
const MAX_RETRIES = 10;
// Exported so the cron query gates SUBMITTED recovery on the SAME staleness
// window the processor's CAS claims use — no drift between selection and claim.
export const STALE_CLAIM_MS = 5 * 60 * 1000;
const WORKER_ID_PREFIX = "payouts-cron";

function computeNextRetry(retryCount: number): Date {
  const seconds = Math.min(3600, Math.max(30, 2 ** retryCount * 15));
  return new Date(Date.now() + seconds * 1000);
}

export type PayoutOutcome =
  | { outcome: "confirmed"; betId: string; winnerTxSig: string; feeTxSig: string | null }
  | { outcome: "failed"; betId: string; reason: string; retryCount: number }
  | { outcome: "failed_terminal"; betId: string; reason: string }
  | { outcome: "skipped"; betId: string; reason: string };

export interface PayoutBetInput {
  id: string;
  winnerId: string | null;
  escrowLockedAt: Date | null;
  onChainPayoutStatus: OnChainPayoutStatus | null;
  payoutWinnerTxSig: string | null;
  payoutFeeTxSig: string | null;
  payoutRetryCount: number;
}

/**
 * SETTLE-path on-chain payout: releases USDC from the shared escrow wallet to
 * the winner's embedded wallet and the platform fee wallet, draining the escrow
 * so its on-chain balance matches the already-finalized ledger.
 *
 * INVARIANT (ledger-before-chain): the ledger is ALWAYS finalized before this
 * runs — `preparePayoutFields` only arms `onChainPayoutStatus=PENDING` after the
 * settle ledger entries are committed. This processor NEVER writes ledger
 * entries and NEVER touches balances; it only moves USDC on-chain and persists
 * signatures + status. (VOID path / cron driver are separate steps.)
 *
 * Dispatches on the current payout substatus:
 *   PENDING | FAILED → send the legs, then verify → CONFIRMED.
 *   SUBMITTED        → recovery: verify the persisted sig(s), NEVER resend.
 *
 * KNOWN ISSUE 2 (claim staleness): the CAS claim can in principle expire
 * (> STALE_CLAIM_MS) between claim and the on-chain transfer, letting a second
 * worker reclaim and also dispatch a leg. STALE_CLAIM_MS (5 min) is set far
 * above the few fast DB lookups that precede the transfer, so this window is
 * not reachable in practice. If it ever were, the stable per-leg
 * `idempotencyKey` (payout-winner/payout-fee:${betId}) is the last line of
 * defense against a duplicate on-chain send, and the SUBMITTED-CAS count guard
 * (below) stops the stale worker from finalizing. Both signing workers share
 * STALE_CLAIM_MS so this bound holds uniformly.
 *
 * KNOWN ISSUE 3 (v1, audit-only): the `payout_confirmed` betStateTransition is
 * written AFTER the CONFIRMED CAS in a separate statement, so a crash in
 * between leaves a CONFIRMED bet without its audit row. No money impact (the
 * sigs + status are the source of truth); accepted for v1.
 */
export async function processBetPayout(bet: PayoutBetInput): Promise<PayoutOutcome> {
  if (bet.onChainPayoutStatus === "PENDING" || bet.onChainPayoutStatus === "FAILED") {
    return await processPendingPayout(bet);
  }
  if (bet.onChainPayoutStatus === "SUBMITTED") {
    return await recoverSubmittedPayout(bet);
  }
  return { outcome: "skipped", betId: bet.id, reason: `not actionable (status=${bet.onChainPayoutStatus})` };
}

// ── PENDING / FAILED: send the legs ──────────────────────────────────

async function processPendingPayout(bet: PayoutBetInput): Promise<PayoutOutcome> {
  const workerId = `${WORKER_ID_PREFIX}:${crypto.randomUUID().substring(0, 8)}`;
  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS);

  // Req 1 — CAS claim: exactly one worker wins PENDING/FAILED. SUBMITTED is
  // intentionally NOT claimable here (it means "already dispatched").
  const claim = await prisma.bet.updateMany({
    where: {
      id: bet.id,
      onChainPayoutStatus: { in: ["PENDING", "FAILED"] },
      OR: [
        { payoutProcessingAt: null },
        { payoutProcessingAt: { lt: staleThreshold } },
      ],
    },
    data: {
      payoutProcessingAt: new Date(),
      payoutProcessingBy: workerId,
      payoutAttemptedAt: new Date(),
    },
  });

  if (claim.count !== 1) {
    return { outcome: "skipped", betId: bet.id, reason: "claim lock failed" };
  }

  // Defensive re-check of the arming gate: only locked bets ever held escrow USDC.
  if (bet.escrowLockedAt === null) {
    return await markTerminal(bet, "bet never locked — nothing to release on-chain");
  }
  if (!bet.winnerId) {
    return await markTerminal(bet, "no winnerId on a settle-path payout");
  }

  // Req 2 — read amounts STRICTLY from the settle ledger entries. Note encodes
  // betId so this never collides with ESCROW_LOCK deposits or withdrawal/dispute
  // FEE_COLLECTION rows that also carry refType=bet.
  const winnerEntry = await prisma.ledgerEntry.findFirst({
    where: {
      entryType: "SETTLEMENT_PAYOUT",
      note: `bet-settle-payout:${bet.id}`,
      transaction: { refType: "bet", refId: bet.id },
    },
    select: { amountUnits: true },
  });
  const feeEntry = await prisma.ledgerEntry.findFirst({
    where: {
      entryType: "FEE_COLLECTION",
      note: `bet-settle-fee:${bet.id}`,
      transaction: { refType: "bet", refId: bet.id },
    },
    select: { amountUnits: true },
  });

  if (!winnerEntry) {
    // Missing settlement entry → hard fail, NEVER guess an amount.
    return await markTerminal(bet, "ledger SETTLEMENT_PAYOUT entry missing — cannot derive winner amount");
  }
  const winnerUnits = winnerEntry.amountUnits;
  const feeUnits = feeEntry?.amountUnits ?? 0n;

  // Winner is a RECIPIENT only (escrow signs, not the winner) → guard the
  // address only; delegation is irrelevant for receiving.
  const winner = await prisma.user.findUnique({
    where: { id: bet.winnerId },
    select: { embeddedWalletAddress: true },
  });
  if (!winner?.embeddedWalletAddress) {
    return await markTerminal(bet, "winner has no embeddedWalletAddress — refuse transfer to null");
  }

  const env = getEnv();
  if (!env.ESCROW_WALLET_ID) {
    // Config error: the proven signing path needs the walletId. Retry (not
    // terminal) so it self-heals once the env is set.
    return await markRetryOrTerminal(bet, new Error("ESCROW_WALLET_ID not configured — cannot sign escrow release"));
  }

  // ── Req 3/4 — WINNER leg first ─────────────────────────────────────
  let winnerSig: string;
  if (bet.payoutWinnerTxSig) {
    winnerSig = bet.payoutWinnerTxSig; // sent in a prior run; verified at finalize.
  } else {
    try {
      const res = await transferUsdcOnChain({
        fromWalletAddress: env.ESCROW_WALLET_ADDRESS,
        fromWalletId: env.ESCROW_WALLET_ID,
        toWalletAddress: winner.embeddedWalletAddress,
        amountUnits: winnerUnits,
        idempotencyKey: `payout-winner:${bet.id}`,
        contextLabel: `payout-winner:${bet.id}`,
      });
      winnerSig = res.txSignature;
    } catch (err) {
      return await markRetryOrTerminal(bet, err);
    }
    // Persist DIRECTLY in its own update so a crash before the fee leg never
    // loses the winner sig — the next run skips the winner transfer.
    await prisma.bet.update({
      where: { id: bet.id },
      data: { payoutWinnerTxSig: winnerSig },
    });
  }

  // ── Req 3/4 — FEE leg second (skip when fee is 0) ──────────────────
  let feeSig: string | null = null;
  if (feeUnits > 0n) {
    if (bet.payoutFeeTxSig) {
      feeSig = bet.payoutFeeTxSig;
    } else {
      try {
        const res = await transferUsdcOnChain({
          fromWalletAddress: env.ESCROW_WALLET_ADDRESS,
          fromWalletId: env.ESCROW_WALLET_ID,
          toWalletAddress: env.FEE_WALLET_ADDRESS,
          amountUnits: feeUnits,
          idempotencyKey: `payout-fee:${bet.id}`,
          contextLabel: `payout-fee:${bet.id}`,
        });
        feeSig = res.txSignature;
      } catch (err) {
        return await markRetryOrTerminal(bet, err);
      }
      await prisma.bet.update({
        where: { id: bet.id },
        data: { payoutFeeTxSig: feeSig },
      });
    }
  }

  // Req 7 — durable waypoint: both legs dispatched → SUBMITTED. CAS so a slow
  // second worker can never reopen it. We MUST gate finalize on this CAS: if
  // our claim went stale mid-flight and another worker reclaimed (count===0),
  // continuing to finalize would let both workers drive the fee leg, collapsing
  // double-pay protection onto Privy's undocumented dedupe. Bail instead.
  const submit = await prisma.bet.updateMany({
    where: { id: bet.id, onChainPayoutStatus: { in: ["PENDING", "FAILED"] }, payoutProcessingBy: workerId },
    data: { onChainPayoutStatus: "SUBMITTED" },
  });
  if (submit.count !== 1) {
    return { outcome: "skipped", betId: bet.id, reason: "lost claim before submit" };
  }

  // Verify the sig(s) and finalize to CONFIRMED (transferUsdcOnChain already
  // confirmed freshly-sent legs, so this normally passes immediately; it also
  // re-validates sigs carried over from a prior run via the skip path).
  return await finalizePayout(bet.id, bet.payoutRetryCount, winnerSig, feeSig, feeUnits);
}

// ── SUBMITTED: recover a crashed dispatch (verify only, never resend) ─

async function recoverSubmittedPayout(bet: PayoutBetInput): Promise<PayoutOutcome> {
  const workerId = `${WORKER_ID_PREFIX}:${crypto.randomUUID().substring(0, 8)}`;
  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS);

  // Only reclaim a SUBMITTED bet whose previous worker went stale.
  const claim = await prisma.bet.updateMany({
    where: {
      id: bet.id,
      onChainPayoutStatus: "SUBMITTED",
      OR: [
        { payoutProcessingAt: null },
        { payoutProcessingAt: { lt: staleThreshold } },
      ],
    },
    data: { payoutProcessingAt: new Date(), payoutProcessingBy: workerId },
  });
  if (claim.count !== 1) {
    return { outcome: "skipped", betId: bet.id, reason: "submitted claim lock failed" };
  }

  // Re-read fee amount + the persisted sigs from the source of truth.
  const feeEntry = await prisma.ledgerEntry.findFirst({
    where: {
      entryType: "FEE_COLLECTION",
      note: `bet-settle-fee:${bet.id}`,
      transaction: { refType: "bet", refId: bet.id },
    },
    select: { amountUnits: true },
  });
  const feeUnits = feeEntry?.amountUnits ?? 0n;

  if (!bet.payoutWinnerTxSig) {
    // SUBMITTED without a winner sig is structurally impossible — never resend
    // on doubt; flag for an admin.
    return await markRetryOrTerminal(bet, new Error("SUBMITTED bet missing payoutWinnerTxSig — refuse blind resend"));
  }

  return await finalizePayout(bet.id, bet.payoutRetryCount, bet.payoutWinnerTxSig, bet.payoutFeeTxSig, feeUnits);
}

// ── Verify on-chain + CONFIRM (Req 3 verification, "bij twijfel niet betalen") ─

type SigVerdict = "confirmed" | "failed" | "unknown";

async function verifySig(sig: string): Promise<SigVerdict> {
  try {
    const conn = getSolanaConnection();
    const res = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const status = res.value[0];
    if (!status) return "unknown"; // not found, even searching history
    if (status.err) return "failed"; // landed but failed on-chain
    if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
      return "confirmed";
    }
    return "unknown"; // only "processed" so far
  } catch {
    return "unknown";
  }
}

async function finalizePayout(
  betId: string,
  retryCount: number,
  winnerSig: string,
  feeSig: string | null,
  feeUnits: bigint,
): Promise<PayoutOutcome> {
  const winnerVerdict = await verifySig(winnerSig);
  const feeVerdict: SigVerdict = feeUnits > 0n && feeSig ? await verifySig(feeSig) : "confirmed";

  if (winnerVerdict === "confirmed" && feeVerdict === "confirmed") {
    // Req 7 — CAS finalize. SUBMITTED is the normal source; PENDING/FAILED
    // covered for the inline same-run case.
    const done = await prisma.bet.updateMany({
      where: { id: betId, onChainPayoutStatus: { in: ["PENDING", "FAILED", "SUBMITTED"] } },
      data: {
        onChainPayoutStatus: "CONFIRMED",
        payoutConfirmedAt: new Date(),
        payoutLastError: null,
        payoutProcessingAt: null,
        payoutProcessingBy: null,
      },
    });
    if (done.count !== 1) {
      return { outcome: "skipped", betId, reason: "lost finalize race" };
    }

    await prisma.betStateTransition.create({
      data: {
        betId,
        fromStatus: "SETTLED",
        toStatus: "SETTLED",
        actorId: null,
        actorType: "SYSTEM_CRON",
        metadata: {
          event: "payout_confirmed",
          winnerTxSig: winnerSig,
          feeTxSig: feeSig,
          source: WORKER_ID_PREFIX,
        },
      },
    });

    logger.info(
      { betId, winnerTxSig: winnerSig, feeTxSig: feeSig },
      "on-chain payout confirmed — escrow released to winner + fee wallet",
    );
    return { outcome: "confirmed", betId, winnerTxSig: winnerSig, feeTxSig: feeSig };
  }

  // Any non-confirmed leg → never resend; record + retry, then terminal + alarm.
  const reason = `payout sig unverified (winner=${winnerVerdict}, fee=${feeVerdict}) — refuse blind resend`;
  return await markRetryOrTerminalById(betId, retryCount, reason);
}

// ── Failure transitions (NO ledger reversal — ledger is already final) ─

async function markRetryOrTerminal(bet: PayoutBetInput, err: unknown): Promise<PayoutOutcome> {
  const reason =
    err instanceof TransferUsdcError
      ? `${err.code}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return await markRetryOrTerminalById(bet.id, bet.payoutRetryCount, reason);
}

async function markRetryOrTerminalById(
  betId: string,
  retryCount: number,
  reason: string,
): Promise<PayoutOutcome> {
  const nextCount = retryCount + 1;
  if (nextCount >= MAX_RETRIES) {
    return await markTerminalById(betId, `max retries: ${reason}`);
  }

  await prisma.bet.update({
    where: { id: betId },
    data: {
      onChainPayoutStatus: "FAILED",
      payoutLastError: reason.substring(0, 500),
      payoutRetryCount: { increment: 1 },
      payoutNextRetryAt: computeNextRetry(nextCount),
      payoutProcessingAt: null,
      payoutProcessingBy: null,
    },
  });

  logger.warn({ betId, retryCount: nextCount, reason }, "on-chain payout failed, scheduled retry");
  return { outcome: "failed", betId, reason, retryCount: nextCount };
}

async function markTerminal(bet: PayoutBetInput, reason: string): Promise<PayoutOutcome> {
  return await markTerminalById(bet.id, reason);
}

async function markTerminalById(betId: string, reason: string): Promise<PayoutOutcome> {
  await prisma.bet.update({
    where: { id: betId },
    data: {
      onChainPayoutStatus: "FAILED_TERMINAL",
      payoutLastError: reason.substring(0, 500),
      payoutProcessingAt: null,
      payoutProcessingBy: null,
    },
  });

  await prisma.betStateTransition.create({
    data: {
      betId,
      fromStatus: "SETTLED",
      toStatus: "SETTLED",
      actorId: null,
      actorType: "SYSTEM_CRON",
      metadata: { event: "payout_failed_terminal", reason, source: `${WORKER_ID_PREFIX}-terminal` },
    },
  });

  logger.error(
    { betId, reason },
    "on-chain payout FAILED_TERMINAL — escrow NOT released, manual admin intervention required",
  );
  return { outcome: "failed_terminal", betId, reason };
}
