import type { LedgerSettlementStatus } from "@prisma/client";

export type LedgerOutcome = "SETTLE" | "VOID";

/**
 * Returns Prisma update fields to set inside a DB transaction when a bet
 * transitions to a terminal status (SETTLED or VOID).
 *
 * Usage inside $transaction:
 *   const ledgerData = prepareLedgerFields("SETTLE", winnerId);
 *   await tx.bet.update({ where: { id }, data: { ...statusFields, ...ledgerData } });
 *
 * After commit, call finalizeLedgerForBet(betId, reason).
 */
export function prepareLedgerFields(
  outcome: LedgerOutcome,
  targetWinnerId?: string | null,
) {
  return {
    ledgerStatus: "PENDING" as LedgerSettlementStatus,
    ledgerOutcome: outcome,
    ledgerTargetWinnerId: outcome === "SETTLE" ? (targetWinnerId ?? null) : null,
    ledgerRetryCount: 0,
    ledgerNextRetryAt: new Date(),
    ledgerLastError: null,
    ledgerErrorCode: null,
    ledgerProcessingAt: null,
    ledgerProcessingBy: null,
    ledgerFinalizedAt: null,
  };
}
