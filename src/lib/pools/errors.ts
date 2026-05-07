/**
 * Domain-specific errors for pool lifecycle operations.
 *
 * Status codes follow REST conventions:
 * - 400 for client validation errors
 * - 403 for ownership violations
 * - 404 for not found
 * - 409 for status conflicts (lifecycle transition rejected)
 *
 * Services may pass a custom statusCode to PoolError where the
 * default for that code (e.g., POOL_INVALID_STATUS = 400) needs
 * to be elevated to 409 (conflict) for transition violations.
 */
export type PoolErrorCode =
  | "POOL_NOT_FOUND"
  | "POOL_INVALID_STATUS"
  | "POOL_TITLE_INVALID"
  | "POOL_SIDES_INVALID"
  | "POOL_DEADLINE_INVALID"
  | "POOL_CREATOR_FEE_OUT_OF_RANGE"
  | "POOL_HAS_BETS_CANNOT_CANCEL"
  | "POOL_NOT_OWNED_BY_CALLER";

export class PoolError extends Error {
  readonly code: PoolErrorCode;
  readonly statusCode: number;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: PoolErrorCode,
    message: string,
    statusCode = 400,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PoolError";
    this.code = code;
    this.statusCode = statusCode;
    this.meta = meta;

    // Maintain proper stack trace for V8 (Node.js)
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, PoolError);
    }
  }
}
