export type LedgerFinalizerErrorCode =
  | "LEDGER_ALREADY_FINALIZED"
  | "LEDGER_LOCK_HELD"
  | "LEDGER_INVARIANT_VIOLATION"
  | "LEDGER_OUTCOME_MISMATCH"
  | "LEDGER_SETTLEMENT_FAILED";

export class LedgerFinalizerError extends Error {
  constructor(
    public readonly code: LedgerFinalizerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerFinalizerError";
  }
}
