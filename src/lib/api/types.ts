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
  serializeDispute,
  serializeMatch,
  serializeTemplate,
  serializeUser,
  serializeUserAdmin,
  serializePool,
  serializeReputation,
  serializeFinancialAccount,
} from "@/lib/http/serialize";

export type BetSerialized = ReturnType<typeof serializeBet>;
export type BetResultClaimSerialized = ReturnType<typeof serializeBetResultClaim>;
export type BetParticipantConfirmationSerialized = ReturnType<typeof serializeBetParticipantConfirmation>;
export type BetTemplateSerialized = ReturnType<typeof serializeTemplate>;
export type DisputeSerialized = ReturnType<typeof serializeDispute>;
export type MatchSerialized = ReturnType<typeof serializeMatch>;
export type UserSerialized = ReturnType<typeof serializeUser>;
export type UserAdminSerialized = ReturnType<typeof serializeUserAdmin>;
export type PoolSerialized = ReturnType<typeof serializePool>;
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

export type SupportedSport =
  | "football"
  | "basketball"
  | "american_football"
  | "ice_hockey"
  | "baseball"
  | "tennis"
  | "mma";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";
