"use client";

import { useQuery } from "@tanstack/react-query";
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
  return useQuery<BetSerialized>({
    queryKey: ["bet", betId],
    queryFn: ({ signal }) => {
      if (!betId) throw new Error("betId required");
      return getBet(betId, { signal });
    },
    enabled: Boolean(betId),
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
