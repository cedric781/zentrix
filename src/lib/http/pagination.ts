import "server-only";
import { z } from "zod";

export class InvalidCursorError extends Error {
  constructor(msg: string = "Invalid pagination cursor") {
    super(msg);
    this.name = "InvalidCursorError";
  }
}

export interface CursorPayload {
  id: string;
  createdAt: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): CursorPayload {
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { id?: unknown }).id !== "string" ||
    typeof (parsed as { createdAt?: unknown }).createdAt !== "string"
  ) {
    throw new InvalidCursorError();
  }
  return parsed as CursorPayload;
}

export function parseCursor(raw: string | undefined): CursorPayload | null {
  if (!raw) return null;
  return decodeCursor(raw);
}

export const CursorQuery = z.object({
  cursor: z.string().min(1).optional(),
  take: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const OffsetQuery = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  take: z.coerce.number().int().min(1).max(100).optional().default(25),
});
