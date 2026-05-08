import "server-only";

export type PoolErrorCode =
  | "POOL_NOT_FOUND"
  | "POOL_NOT_OWNED_BY_CALLER"
  | "POOL_INVALID_STATUS"
  | "POOL_INVALID_INPUT"
  | "POOL_VERSION_MISMATCH"
  | "POOL_HAS_BETS_CANNOT_CANCEL"
  | "POOL_DEADLINE_INVALID";

export class PoolError extends Error {
  constructor(
    public code: PoolErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "PoolError";
  }
}
