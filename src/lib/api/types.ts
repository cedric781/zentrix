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
  serializeUser,
  serializeUserAdmin,
  serializePool,
  serializeReputation,
  serializeFinancialAccount,
} from "@/lib/http/serialize";

export type BetSerialized = ReturnType<typeof serializeBet>;
export type BetResultClaimSerialized = ReturnType<typeof serializeBetResultClaim>;
export type BetParticipantConfirmationSerialized = ReturnType<typeof serializeBetParticipantConfirmation>;
export type DisputeSerialized = ReturnType<typeof serializeDispute>;
export type MatchSerialized = ReturnType<typeof serializeMatch>;
export type UserSerialized = ReturnType<typeof serializeUser>;
export type UserAdminSerialized = ReturnType<typeof serializeUserAdmin>;
export type PoolSerialized = ReturnType<typeof serializePool>;
export type ReputationSerialized = ReturnType<typeof serializeReputation>;
export type FinancialAccountSerialized = ReturnType<typeof serializeFinancialAccount>;

export type PaginationMeta = {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

export type Paginated<T> = {
  items: T[];
} & PaginationMeta;

export type ApiErrorBody = {
  error: string;
  message?: string;
};
