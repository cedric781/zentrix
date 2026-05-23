"use client";

/**
 * usePools — infinite query for /api/pools.
 *
 * scope=public returns OPEN/CLOSED/SETTLED pools across all users (default
 * on the API). scope=mine returns the caller's pools across all statuses.
 * Both require auth; hook is auto-disabled until Privy is ready + authed.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import {
  listPools,
  type PoolScope,
  type PoolStatus,
} from "@/lib/api/pools";

export interface UsePoolsParams {
  scope: PoolScope;
  status?: PoolStatus;
  take?: number;
}

export function usePools({ scope, status, take }: UsePoolsParams) {
  const { ready, authenticated, getAccessToken } = usePrivy();

  return useInfiniteQuery({
    queryKey: ["pools", { scope, status, take }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const token = await getAccessToken();
      return listPools(
        { scope, status, cursor: pageParam, take },
        { token: token ?? undefined, signal },
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: ready && authenticated,
    staleTime: 30_000,
  });
}
