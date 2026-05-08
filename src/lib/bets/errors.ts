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
  | "BET_CREATOR_BETTING_OWN_POOL";

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
