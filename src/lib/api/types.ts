/**
 * Client-safe API response types from src/lib/http/serialize.ts.
 * serialize.ts has no `server-only` import — only Prisma type imports, erased at build.
 *
 * Pitfall: bigToStr returns string | null, so stakeUnits is nullable in types
 * even though Prisma schema requires non-null. Handle defensively in UI.
 */

import type {
  serializeBet,
  serializeBetResultClaim,
  serializeBetParticipantConfirmation,
  serializeDeposit,
  serializeDispute,
  serializeMatch,
  serializeTemplate,
  serializeUser,
  serializeUserAdmin,
  serializePool,
  serializePoolParticipant,
  serializeReputation,
  serializeFinancialAccount,
} from "@/lib/http/serialize";

export type BetSerialized = ReturnType<typeof serializeBet>;
export type BetResultClaimSerialized = ReturnType<typeof serializeBetResultClaim>;
export type BetParticipantConfirmationSerialized = ReturnType<typeof serializeBetParticipantConfirmation>;
export type BetTemplateSerialized = ReturnType<typeof serializeTemplate>;
export type DepositSerialized = ReturnType<typeof serializeDeposit>;
export type DisputeSerialized = ReturnType<typeof serializeDispute>;
export type MatchSerialized = ReturnType<typeof serializeMatch>;
export type UserSerialized = ReturnType<typeof serializeUser>;
export type UserAdminSerialized = ReturnType<typeof serializeUserAdmin>;
export type PoolSerialized = ReturnType<typeof serializePool>;
export type PoolParticipantSerialized = ReturnType<typeof serializePoolParticipant>;
export type ReputationSerialized = ReturnType<typeof serializeReputation>;
export type FinancialAccountSerialized = ReturnType<typeof serializeFinancialAccount>;

/**
 * Backend pagination envelope from list endpoints.
 * Actual shape from src/app/api/bets/route.ts (and others):
 *   { items: T[], nextCursor: string | null }
 *
 * hasMore is derived: nextCursor !== null.
 */
export type Paginated<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ApiErrorBody = {
  error: string;
  message?: string;
};

// ── P30: external result providers ────────────────────────────────

export type SupportedProvider = "espn" | "thesportsdb" | "football-data";

export const SUPPORTED_SPORTS = [
  "football",
  "basketball",
  "american_football",
  "ice_hockey",
  "baseball",
  "tennis",
  "mma",
] as const;

export type SupportedSport = (typeof SUPPORTED_SPORTS)[number];

export function isSupportedSport(s: string): s is SupportedSport {
  return (SUPPORTED_SPORTS as readonly string[]).includes(s);
}

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

// ── P31: external event linking on create-bet ────────────────────

export type CreateBetExternalRef = {
  provider: "espn" | "thesportsdb";
  eventId: string;
  league: string;
  sport: SupportedSport;
  eventStartsAt: string; // ISO
  eventEndsAt: string;   // ISO
};

export type TemplateAllowedSource = {
  name: string;
  providerId: "espn" | "thesportsdb";
  type: string;
};

// ── Settlement (P26) ─────────────────────────────────────────────────
// BetResultClaimSerialized and BetParticipantConfirmationSerialized are
// already declared above via ReturnType<typeof serialize…>.

export type ConfirmationDecision = "CONFIRM_WINNER" | "DISAGREE";

export type ProposeResultBody = {
  claimedWinnerId: string;
  note?: string;
};

// Discriminated union: TS dwingt af dat DISAGREE altijd claimedWinnerId
// meestuurt. Server checkt dezelfde regel runtime — dubbele bescherming.
export type ConfirmResultBody =
  | { decision: "CONFIRM_WINNER" }
  | { decision: "DISAGREE"; claimedWinnerId: string };

export type ProposeResultResponse = {
  bet: BetSerialized;
  claim: BetResultClaimSerialized;
};

export type ConfirmResultResponse = {
  bet: BetSerialized;
  confirmation: BetParticipantConfirmationSerialized;
};
