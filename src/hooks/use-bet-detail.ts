"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { getBet } from "@/lib/api/bets";
import type { BetSerialized } from "@/lib/api/types";
import type { BetStatus } from "@/lib/api/bets";

/**
 * Statussen waar settlement actie verwacht wordt → polling 15s.
 * Andere statussen: focus-refetch only, geen interval.
 *
 * RESULT_PROPOSED en AWAITING_CONFIRMATION zijn beide "wachten op confirm"
 * vanuit UI perspectief — geen reden om te differentiëren.
 */
const ACTIVE_SETTLEMENT_STATUSES: BetStatus[] = [
  "RESULT_PROPOSED",
  "AWAITING_CONFIRMATION",
];

export function useBetDetail(betId: string | undefined) {
  const { getAccessToken, ready, authenticated } = usePrivy();

  return useQuery<BetSerialized>({
    // queryKey includes auth state to prevent stale-token caching across logins
    queryKey: ["bet", betId, authenticated],
    queryFn: async ({ signal }) => {
      if (!betId) throw new Error("betId required");
      const token = await getAccessToken();
      if (!token) throw new Error("not authenticated");
      return getBet(betId, { token, signal });
    },
    enabled: Boolean(betId) && ready && authenticated,
    refetchInterval: (query) => {
      const bet = query.state.data;
      if (!bet) return false;
      return ACTIVE_SETTLEMENT_STATUSES.includes(bet.status as BetStatus)
        ? 15_000
        : false;
    },
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}
