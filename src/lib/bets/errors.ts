import "server-only";

export type BetErrorCode =
  | "BET_NOT_FOUND"
  | "BET_NOT_OWNED_BY_CALLER"
  | "BET_INVALID_STATUS"
  | "BET_INVITE_INVALID"
  | "BET_ALREADY_ACCEPTED"
  | "BET_EXPIRED"
  | "BET_INSUFFICIENT_BALANCE"
  | "BET_VERSION_MISMATCH"
  | "BET_INVALID_INPUT"
  | "BET_CREATOR_BETTING_OWN_POOL"
  | "BET_NOT_PARTICIPANT"
  | "BET_RESULT_ALREADY_CLAIMED"
  | "BET_RESULT_CLAIM_NOT_FOUND"
  | "BET_CONFIRM_BY_CLAIMANT"
  | "BET_DEADLINE_PASSED"
  | "BET_SETTLEMENT_LEDGER_ERROR"
  | "BET_POOL_MATCH_NOT_OPEN"
  | "BET_NOT_EXPIRED"
  | "BET_NOT_VOIDED"
  | "BET_NO_OPPONENT"
  | "BET_WALLET_NOT_DELEGATED"
  | "BETS_DISABLED";

export class BetError extends Error {
  constructor(
    public code: BetErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "BetError";
  }
}
