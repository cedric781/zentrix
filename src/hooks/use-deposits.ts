"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";

import { listDeposits, type DepositStatusFilter } from "@/lib/api/deposits";

export interface UseDepositsParams {
  status?: DepositStatusFilter;
}

/**
 * useDeposits — paginated list of current user's own deposits.
 *
 * Auto-disabled until Privy is ready + authenticated.
 * staleTime 30s: deposits rarely change after CREDITED.
 *
 * Server enforces userId = current user — no scope param needed.
 */
export function useDeposits({ status }: UseDepositsParams = {}) {
  const { ready, authenticated, getAccessToken } = usePrivy();

  return useInfiniteQuery({
    queryKey: ["deposits", { status }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const token = await getAccessToken();
      return listDeposits(
        { status, cursor: pageParam, take: 20 },
        { token: token ?? undefined, signal },
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: ready && authenticated,
    staleTime: 30_000,
  });
}
