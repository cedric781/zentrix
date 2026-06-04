/**
 * Bet endpoint wrappers — thin layer over apiFetch.
 *
 * Note: GET /api/bets supports both "mine" (default — caller's own bets) and
 * "all" (public marketplace) scope via the ?scope= query param. Auth required
 * in both cases — there is no anonymous public-feed endpoint.
 */

import { apiFetch } from "./client";
import type {
  BetSerialized,
  CreateBetExternalRef,
  Paginated,
  ProposeResultBody,
  ConfirmResultBody,
  ProposeResultResponse,
  ConfirmResultResponse,
} from "./types";

/** All status values from prisma/schema.prisma `enum BetStatus`. */
export type BetStatus =
  | "DRAFT"
  | "PENDING_ESCROW"
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
 *   - Required header: Idempotency-Key (UUIDv4)
 *   - Optional body: { inviteToken?: string }
 *   - Returns: { bet: BetSerialized }
 *   - opponentUserId is resolved server-side from auth (not request body)
 *
 * Idempotency: caller-supplied UUIDv4. Server's parseIdempotencyKey
 * requires UUIDv4, so the prior deterministic `${userId}:accept:${betId}`
 * key was rejected. Matches createBet's pattern.
 */
export async function acceptBet(
  params: {
    betId: string;
    inviteToken?: string;
  },
  options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<{ bet: BetSerialized }> {
  return apiFetch<{ bet: BetSerialized }>(
    `/api/bets/${encodeURIComponent(params.betId)}/accept`,
    {
      method: "POST",
      idempotencyKey: options.idempotencyKey,
      body: params.inviteToken ? { inviteToken: params.inviteToken } : {},
      signal: options.signal,
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
  /** Settlement intent. Defaults server-side to PEER_AGREE. AUTO_VERIFY ⟺ externalRef. */
  settlementMode?: "PEER_AGREE" | "AUTO_VERIFY";
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

/**
 * POST /api/bets/[id]/propose-result.
 *
 * Transitions bet ACTIVE → RESULT_PROPOSED server-side.
 * Caller is recorded in BetResultClaim.claimedById.
 *
 * Idempotency: caller-supplied UUIDv4. Same key within retry window
 * dedupes server-side (no duplicate claim).
 *
 * @throws ApiError on BET_INVALID_STATUS (409), BET_NOT_PARTICIPANT (403),
 *   BET_INVALID_INPUT (400), UNAUTHORIZED (401).
 */
export async function proposeResult(
  params: { betId: string } & ProposeResultBody,
  options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<ProposeResultResponse> {
  return apiFetch<ProposeResultResponse>(
    `/api/bets/${encodeURIComponent(params.betId)}/propose-result`,
    {
      method: "POST",
      idempotencyKey: options.idempotencyKey,
      body: {
        claimedWinnerId: params.claimedWinnerId,
        ...(params.note !== undefined ? { note: params.note } : {}),
      },
      signal: options.signal,
      retryAttempts: 0,
    },
  );
}

/**
 * POST /api/bets/[id]/confirm-result.
 *
 * CONFIRM_WINNER → bet → SETTLED (payout same TX server-side).
 * DISAGREE       → bet → DISPUTED (settlement paused, no payout).
 *
 * Idempotency: 2-laags. (1) caller UUIDv4 replay protection;
 * (2) server natural-state: existing BetParticipantConfirmation row for
 * (betId, userId) → cached result.
 *
 * @throws ApiError on BET_INVALID_STATUS (409), BET_NOT_PARTICIPANT (403),
 *   BET_INVALID_INPUT (400 — DISAGREE without claimedWinnerId), UNAUTHORIZED (401).
 */
export async function confirmResult(
  params: { betId: string } & ConfirmResultBody,
  options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<ConfirmResultResponse> {
  const body: Record<string, unknown> = { decision: params.decision };
  if (params.decision === "DISAGREE") {
    body.claimedWinnerId = params.claimedWinnerId;
  }
  return apiFetch<ConfirmResultResponse>(
    `/api/bets/${encodeURIComponent(params.betId)}/confirm-result`,
    {
      method: "POST",
      idempotencyKey: options.idempotencyKey,
      body,
      signal: options.signal,
      retryAttempts: 0,
    },
  );
}
