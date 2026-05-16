/**
 * External results client wrappers — thin layer over apiFetch.
 *
 * Backed by:
 *   GET /api/external-results/search   (P40 event autocomplete)
 *
 * Auth required (Privy bearer token).
 */

import { apiFetch } from "./client";
import type { SupportedSport } from "./types";

export type SearchEventsParams = {
  query: string;
  sport: SupportedSport;
  league?: string;
  provider?: "espn" | "thesportsdb";
};

export type ExternalEventSummary = {
  provider: "espn" | "thesportsdb";
  providerEventId: string;
  sport: SupportedSport;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  endsAt?: string;
  label: string;
};

export type SearchEventsResponse = {
  events: ExternalEventSummary[];
};

function buildQuery(params: Record<string, string | undefined>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") entries.push([k, v]);
  }
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

export async function searchEvents(
  params: SearchEventsParams,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<SearchEventsResponse> {
  const qs = buildQuery({
    query: params.query,
    sport: params.sport,
    league: params.league,
    provider: params.provider,
  });
  return apiFetch<SearchEventsResponse>(`/api/external-results/search${qs}`, {
    method: "GET",
    token: options.token,
    signal: options.signal,
  });
}
