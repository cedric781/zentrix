/**
 * Pool endpoint wrappers — thin layer over apiFetch.
 *
 * GET /api/pools supports scope="mine" | "public" (default public on server).
 * Both scopes require auth (consistent with /api/bets).
 *
 * GET /api/pools/[id] returns the pool wrapped in { data } with matches
 * hydrated — unlike the list which is bare { items, nextCursor }.
 */

import { apiFetch } from "./client";
import type {
  MatchSerialized,
  Paginated,
  PoolSerialized,
} from "./types";

/** All status values from prisma/schema.prisma `enum PoolStatus`. */
export type PoolStatus =
  | "DRAFT"
  | "OPEN"
  | "CLOSED"
  | "SETTLED"
  | "CANCELLED";

export type PoolScope = "mine" | "public";

export type ListPoolsParams = {
  scope: PoolScope;
  status?: PoolStatus;
  cursor?: string;
  /** Page size; backend caps via parseListQuery (max 50). */
  take?: number;
};

/**
 * Detail-endpoint shape: PoolSerialized + hydrated matches.
 * Composed from existing serialized types in `./types` — backend builds
 * the same shape inline in /api/pools/[id]/route.ts.
 */
export type PoolWithMatchesSerialized = PoolSerialized & {
  matches: MatchSerialized[];
};

export type GetPoolResponse = {
  data: PoolWithMatchesSerialized;
};

function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      entries.push([k, String(v)]);
    }
  }
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

export async function listPools(
  params: ListPoolsParams,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<Paginated<PoolSerialized>> {
  const qs = buildQuery({
    scope: params.scope,
    status: params.status,
    cursor: params.cursor,
    take: params.take,
  });
  return apiFetch<Paginated<PoolSerialized>>(`/api/pools${qs}`, {
    method: "GET",
    token: options.token,
    signal: options.signal,
  });
}

export async function getPool(
  id: string,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<GetPoolResponse> {
  return apiFetch<GetPoolResponse>(
    `/api/pools/${encodeURIComponent(id)}`,
    {
      method: "GET",
      token: options.token,
      signal: options.signal,
    },
  );
}

// ── Mutations ────────────────────────────────────────────────────────

export type CreatePoolInput = {
  title: string;
  description?: string;
  /** ISO 8601 datetime string. Server validates 1h-90d ahead. */
  bettingClosesAt: string;
};

export type CreatePoolResponse = { data: PoolSerialized };
export type PublishPoolResponse = { data: PoolSerialized };

export type AddMatchInput = {
  title: string;
  description?: string;
  /** ISO 8601 datetime string. Server requires future time. */
  eventTime?: string;
};

export type AddMatchResponse = { data: MatchSerialized };

export async function createPool(
  input: CreatePoolInput,
  options: { token?: string; idempotencyKey: string; signal?: AbortSignal },
): Promise<CreatePoolResponse> {
  return apiFetch<CreatePoolResponse>(`/api/pools`, {
    method: "POST",
    token: options.token,
    idempotencyKey: options.idempotencyKey,
    body: input,
    signal: options.signal,
    retryAttempts: 0,
  });
}

export async function publishPool(
  poolId: string,
  options: { token?: string; idempotencyKey: string; signal?: AbortSignal },
): Promise<PublishPoolResponse> {
  return apiFetch<PublishPoolResponse>(
    `/api/pools/${encodeURIComponent(poolId)}/publish`,
    {
      method: "POST",
      token: options.token,
      idempotencyKey: options.idempotencyKey,
      signal: options.signal,
      retryAttempts: 0,
    },
  );
}

export async function addMatchToPool(
  poolId: string,
  input: AddMatchInput,
  options: { token?: string; idempotencyKey: string; signal?: AbortSignal },
): Promise<AddMatchResponse> {
  return apiFetch<AddMatchResponse>(
    `/api/pools/${encodeURIComponent(poolId)}/matches`,
    {
      method: "POST",
      token: options.token,
      idempotencyKey: options.idempotencyKey,
      body: input,
      signal: options.signal,
      retryAttempts: 0,
    },
  );
}
