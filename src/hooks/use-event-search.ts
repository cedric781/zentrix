"use client";

/**
 * useEventSearch — debounced React Query hook for /api/external-results/search.
 *
 * - Disabled until Privy is ready + authenticated and the user has typed at
 *   least 2 characters.
 * - 300ms debounce on the query string (rejects intermediate keystrokes via
 *   useEffect + setTimeout pattern).
 * - 60s staleTime — autocomplete results don't churn often.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { searchEvents } from "@/lib/api/external-results";
import type { SupportedSport } from "@/lib/api/types";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export function useEventSearch(params: {
  query: string;
  sport: SupportedSport | undefined;
  league?: string;
}) {
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [debouncedQuery, setDebouncedQuery] = useState(params.query);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(params.query), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [params.query]);

  const trimmed = debouncedQuery.trim();
  const enabled =
    ready &&
    authenticated &&
    !!params.sport &&
    trimmed.length >= MIN_QUERY_LENGTH;

  return useQuery({
    queryKey: [
      "events",
      "search",
      { query: trimmed, sport: params.sport, league: params.league },
    ],
    queryFn: async ({ signal }) => {
      const token = await getAccessToken();
      return searchEvents(
        {
          query: trimmed,
          sport: params.sport!,
          league: params.league,
        },
        { token: token ?? undefined, signal },
      );
    },
    enabled,
    staleTime: 60_000,
  });
}
