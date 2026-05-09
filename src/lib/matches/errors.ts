import "server-only";

export type MatchErrorCode =
  | "MATCH_NOT_FOUND"
  | "MATCH_NOT_IN_OPEN_POOL"
  | "MATCH_NOT_OWNED_BY_POOL_CREATOR"
  | "MATCH_INVALID_STATUS"
  | "MATCH_INVALID_INPUT"
  | "MATCH_VERSION_MISMATCH"
  | "MATCH_HAS_UNRESOLVED_BETS"
  | "MATCH_RESULT_ALREADY_SUBMITTED";

export class MatchError extends Error {
  constructor(
    public code: MatchErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "MatchError";
  }
}
