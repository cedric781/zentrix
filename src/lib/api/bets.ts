/**
 * Bet endpoint wrappers — thin layer over apiFetch.
 *
 * Note: GET /api/bets supports both "mine" (default — caller's own bets) and
 * "all" (public marketplace) scope via the ?scope= query param. Auth required
 * in both cases — there is no anonymous public-feed endpoint.
 */

import { apiFetch } from "./client";
import type { BetSerialized, CreateBetExternalRef, Paginated } from "./types";

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
  /** 'mine' = caller's bets (default); 'all' = public marketplace. */
  scope?: "mine" | "all";
  /** Optional category filter (denormalized on Bet, see P34 Part A). */
  category?: string;
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
    scope: params.scope,
    category: params.category,
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

/**
 * Create a new peer-to-peer bet.
 *
 * Backend signature (src/app/api/bets/route.ts):
 *   - Required header: Idempotency-Key (UUIDv4)
 *   - Body: { side, stakeUnits (integer decimal string), expiresInHours (1-168),
 *            title, outcomeA, outcomeB, poolId?, matchId? }
 *   - Returns: { bet: BetSerialized, inviteToken: string }
 *   - creatorId resolved server-side from auth (not request body)
 *
 * Idempotency: caller provides UUIDv4 per submission attempt (each submit =
 * new key). Backend dedupes if same key reused (e.g. network retry).
 */
export type CreateBetInput = {
  side: "A" | "B";
  /** Decimal string of micro-USDC units (no fraction). Server validates `/^\d+$/`. */
  stakeUnits: string;
  /** 1-168 hours. */
  expiresInHours: number;
  title: string;
  outcomeA: string;
  outcomeB: string;
  poolId?: string;
  matchId?: string;
  externalRef?: CreateBetExternalRef;
  // P35: template tracking
  templateId?: string;
  category?: string;
  isCustom?: boolean;
};

export type CreateBetResponse = {
  bet: BetSerialized;
  inviteToken: string;
};

export async function createBet(
  input: CreateBetInput,
  options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<CreateBetResponse> {
  return apiFetch<CreateBetResponse>(`/api/bets`, {
    method: "POST",
    idempotencyKey: options.idempotencyKey,
    body: input,
    signal: options.signal,
    // Financial action: never auto-retry. Caller-managed retry only.
    retryAttempts: 0,
  });
}
