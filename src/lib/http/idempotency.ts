import "server-only";
import { randomUUID } from "node:crypto";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super("Invalid Idempotency-Key header");
    this.name = "InvalidIdempotencyKeyError";
  }
}

export function parseIdempotencyKey(req: Request): string {
  const raw = req.headers.get("idempotency-key");
  if (raw === null || raw === "") return randomUUID();
  if (!UUID_V4.test(raw)) throw new InvalidIdempotencyKeyError();
  return raw;
}
