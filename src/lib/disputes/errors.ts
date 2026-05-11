import "server-only";

export type DisputeErrorCode =
  | "DISPUTE_NOT_FOUND"
  | "DISPUTE_NOT_PARTICIPANT"
  | "DISPUTE_INVALID_STATUS"
  | "DISPUTE_INVALID_INPUT"
  | "DISPUTE_INSUFFICIENT_BALANCE"
  | "DISPUTE_ALREADY_OPEN"
  | "DISPUTE_OUTSIDE_WINDOW"
  | "DISPUTE_EVIDENCE_LIMIT"
  | "DISPUTE_EVIDENCE_INVALID"
  | "DISPUTE_NOT_ADMIN"
  | "DISPUTE_VERSION_MISMATCH";

export class DisputeError extends Error {
  constructor(
    public code: DisputeErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "DisputeError";
  }
}
