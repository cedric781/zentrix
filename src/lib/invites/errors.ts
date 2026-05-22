import "server-only";
import type { BetErrorCode } from "@/lib/bets/errors";

export type InviteErrorCode =
  | "INVITE_NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_USED"
  | "INVITE_BET_NOT_OPEN"
  | "INVITE_SELF_REDEEM"
  | "INVITE_UNAUTHORIZED";

export class InviteError extends Error {
  constructor(
    public code: InviteErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

const BET_TO_INVITE: Partial<Record<BetErrorCode, InviteErrorCode>> = {
  BET_INVITE_INVALID: "INVITE_NOT_FOUND",
  BET_ALREADY_ACCEPTED: "INVITE_ALREADY_USED",
  BET_EXPIRED: "INVITE_EXPIRED",
  BET_INVALID_STATUS: "INVITE_BET_NOT_OPEN",
};

export function mapBetErrorToInvite(
  code: BetErrorCode,
): InviteErrorCode | null {
  return BET_TO_INVITE[code] ?? null;
}
