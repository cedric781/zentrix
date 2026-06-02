import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { processBetPayout, STALE_CLAIM_MS, type PayoutBetInput } from "./processor";

// Conservative for a money path under a 60s route budget (deploy-safe on every
// plan). transferUsdcOnChain BLOCKS on confirmTransaction("confirmed") —
// typically ~1-5s/leg, worst-case ~60-90s/leg (blockhash expiry). At 2 bets/run
// the typical case (~5-15s/bet) finishes well inside 60s; a single slow leg can
// still truncate the run, but that is recoverable (sig persists only after the
// transfer returns → next run retries the same idempotencyKey), never a
// double-pay. Raise to 3 if/when the route's maxDuration goes to 300 on Pro.
const MAX_BETS_PER_RUN = 2;

const PAYOUT_SELECT = {
  id: true,
  winnerId: true,
  escrowLockedAt: true,
  onChainPayoutStatus: true,
  payoutWinnerTxSig: true,
  payoutFeeTxSig: true,
  payoutRetryCount: true,
} as const;

export interface PayoutBatchStats {
  dispatchCandidates: number;
  recoveryCandidates: number;
  confirmed: number;
  failed: number;
  terminal: number;
  skipped: number;
}

/**
 * One payout cron tick. Selects two disjoint candidate sets and runs each bet
 * sequentially through `processBetPayout`. The CAS claims inside the processor
 * are the real mutual-exclusion; these queries are just candidate filters, so
 * overlapping runs are safe (a loser gets `skipped`).
 *
 * Branch A (dispatch): PENDING/FAILED whose retry backoff has elapsed and that
 * are not actively claimed. Branch B (recovery): SUBMITTED whose processing
 * claim has gone STALE — i.e. a worker crashed between dispatch and finalize.
 * A healthy run never leaves a SUBMITTED row (it finalizes inline), so a
 * non-stale SUBMITTED is being handled by a live worker and is intentionally
 * NOT selected. FAILED_TERMINAL and CONFIRMED are excluded from both branches.
 */
export async function processPayoutsBatch(): Promise<PayoutBatchStats> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_CLAIM_MS);

  // Branch A — dispatch candidates.
  const dispatchCandidates = await prisma.bet.findMany({
    where: {
      onChainPayoutStatus: { in: ["PENDING", "FAILED"] },
      AND: [
        { OR: [{ payoutNextRetryAt: null }, { payoutNextRetryAt: { lte: now } }] },
        { OR: [{ payoutProcessingAt: null }, { payoutProcessingAt: { lt: staleThreshold } }] },
      ],
    },
    select: PAYOUT_SELECT,
    take: MAX_BETS_PER_RUN,
    orderBy: { payoutNextRetryAt: "asc" },
  });

  // Branch B — recovery candidates. `{ lt: staleThreshold }` matches only
  // non-null, stale claims; a crashed dispatch always left payoutProcessingAt
  // set, so this is exactly the "worker died mid-flight" set.
  const recoveryCandidates = await prisma.bet.findMany({
    where: {
      onChainPayoutStatus: "SUBMITTED",
      payoutProcessingAt: { lt: staleThreshold },
    },
    select: PAYOUT_SELECT,
    take: MAX_BETS_PER_RUN,
    orderBy: { payoutProcessingAt: "asc" },
  });

  const stats: PayoutBatchStats = {
    dispatchCandidates: dispatchCandidates.length,
    recoveryCandidates: recoveryCandidates.length,
    confirmed: 0,
    failed: 0,
    terminal: 0,
    skipped: 0,
  };

  // Sequential: keep RPC/Privy load predictable and avoid stacking heavy
  // confirmation waits within one run window.
  const candidates: PayoutBetInput[] = [...dispatchCandidates, ...recoveryCandidates];
  for (const bet of candidates) {
    try {
      const result = await processBetPayout(bet);
      switch (result.outcome) {
        case "confirmed": stats.confirmed++; break;
        case "failed": stats.failed++; break;
        case "failed_terminal": stats.terminal++; break;
        case "skipped": stats.skipped++; break;
      }
    } catch (err) {
      logger.error(
        { betId: bet.id, err: err instanceof Error ? err.message : String(err) },
        "payouts cron: unhandled per-bet error",
      );
      stats.failed++;
    }
  }

  return stats;
}
