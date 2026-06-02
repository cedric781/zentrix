import type { OnChainPayoutStatus } from "@prisma/client";

/**
 * Returns Prisma update fields that arm the on-chain payout state machine
 * for a bet that has just reached a terminal ledger state (SETTLED or VOID).
 *
 * GATE: only bets with `escrowLockedAt != null` ever held real USDC in the
 * shared escrow wallet. `escrowLockedAt` is set when the opponent deposit
 * confirms (status → ACTIVE/LOCKED), so locked ⟺ both stakes deposited
 * on-chain. A bet that never locked has nothing to release on-chain, so this
 * returns `{}` and the bet stays out of the payouts cron query.
 *
 * ORDERING (ledger-before-chain): the caller MUST only spread these fields
 * once the ledger has been committed for the bet:
 *   - inline settleBet path: ledger is written synchronously in the same
 *     $transaction, so spread these in that SAME tx.
 *   - two-phase external path: do NOT spread in the settle tx; spread only
 *     after finalizeLedgerForBet() succeeds (markLedgerFinalized).
 * This guarantees we never make a payout eligible before it is booked.
 *
 * Usage inside a Prisma update/updateMany:
 *   data: { ...statusFields, ...preparePayoutFields(bet) }
 */
export function preparePayoutFields(bet: { escrowLockedAt: Date | null }) {
  if (bet.escrowLockedAt === null) {
    return {} as const;
  }
  return {
    onChainPayoutStatus: "PENDING" as OnChainPayoutStatus,
    payoutRetryCount: 0,
    payoutNextRetryAt: new Date(), // immediately eligible for the cron
    payoutLastError: null,
    payoutAttemptedAt: null,
    payoutConfirmedAt: null,
    payoutProcessingAt: null,
    payoutProcessingBy: null,
  };
}
