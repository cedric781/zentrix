import "server-only";
import crypto from "node:crypto";

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function computeTokenHash(plainToken: string): string {
  return crypto.createHash("sha256").update(plainToken).digest("hex");
}
