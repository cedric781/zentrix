import "server-only";

export type ReputationErrorCode =
  | "REPUTATION_USER_NOT_FOUND"
  | "REPUTATION_INVALID_EVENT_TYPE"
  | "REPUTATION_DUPLICATE_EVENT"
  | "REPUTATION_INVALID_DELTA";

export class ReputationError extends Error {
  constructor(
    public code: ReputationErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "ReputationError";
  }
}
