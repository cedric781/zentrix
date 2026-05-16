"use client";

/**
 * useBets — infinite query for /api/bets.
 *
 * scope=mine returns the caller's bets (createdById OR opponentUserId);
 * scope=all returns the public marketplace (auth still required, defaults
 * to status IN (OPEN, ACTIVE) unless status filter is supplied).
 *
 * Auto-disabled until Privy is ready + authenticated.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { listBets, type BetStatus } from "@/lib/api/bets";

export interface UseBetsParams {
  scope: "mine" | "all";
  status?: BetStatus;
  category?: string;
}

export function useBets({ scope, status, category }: UseBetsParams) {
  const { ready, authenticated, getAccessToken } = usePrivy();

  return useInfiniteQuery({
    queryKey: ["bets", { scope, status, category }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const token = await getAccessToken();
      return listBets(
        { scope, status, category, cursor: pageParam, take: 20 },
        { token: token ?? undefined, signal },
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: ready && authenticated,
    staleTime: 30_000,
  });
}
