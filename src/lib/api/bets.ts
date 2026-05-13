/**
 * Bet endpoint wrappers — thin layer over apiFetch.
 *
 * Note: GET /api/bets is "MY BETS" (requires auth, filtered by current user
 * server-side). There is no public-feed endpoint yet.
 */

import { apiFetch } from "./client";
import type { BetSerialized, Paginated } from "./types";

/** All status values from prisma/schema.prisma `enum BetStatus`. */
export type BetStatus =
  | "DRAFT"
  | "OPEN"
  | "ACTIVE"
  | "RESULT_PROPOSED"
  | "AWAITING_CONFIRMATION"
  | "DISPUTED"
  | "SETTLED"
  | "CANCELLED"
  | "EXPIRED"
  | "VOID";

export type ListBetsParams = {
  cursor?: string;
  /** Page size; backend caps via parseListQuery. */
  take?: number;
  status?: BetStatus;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      entries.push([k, String(v)]);
    }
  }
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

export async function listBets(
  params: ListBetsParams = {},
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<Paginated<BetSerialized>> {
  const qs = buildQuery({
    cursor: params.cursor,
    take: params.take,
    status: params.status,
  });
  return apiFetch<Paginated<BetSerialized>>(`/api/bets${qs}`, {
    method: "GET",
    token: options.token,
    signal: options.signal,
  });
}

export async function getBet(
  id: string,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<BetSerialized> {
  return apiFetch<BetSerialized>(`/api/bets/${encodeURIComponent(id)}`, {
    method: "GET",
    token: options.token,
    signal: options.signal,
  });
}

/**
 * Accept an OPEN bet on behalf of the current user.
 *
 * Backend signature (src/app/api/bets/[id]/accept/route.ts):
 *   - Required header: Idempotency-Key
 *   - Optional body: { inviteToken?: string }
 *   - Returns: { bet: BetSerialized }
 *   - opponentUserId is resolved server-side from auth (not request body)
 *
 * Idempotency strategy: deterministic key per (user, intent, bet).
 * Caller passes the userId resolved from useCurrentUser().
 * Same user clicking accept twice generates the same key →
 * backend dedupes and returns cached result (no double-debit).
 */
export async function acceptBet(
  params: {
    betId: string;
    userId: string;
    inviteToken?: string;
  },
  options: { signal?: AbortSignal } = {},
): Promise<{ bet: BetSerialized }> {
  const idempotencyKey = `${params.userId}:accept:${params.betId}`;
  return apiFetch<{ bet: BetSerialized }>(
    `/api/bets/${encodeURIComponent(params.betId)}/accept`,
    {
      method: "POST",
      idempotencyKey,
      body: params.inviteToken ? { inviteToken: params.inviteToken } : {},
      signal: options.signal,
      // Do NOT retry on transient: accept is state-changing, idempotency-key
      // already protects against duplicates within the retry window.
      retryAttempts: 0,
    },
  );
}
