"use client";

/**
 * usePool — single pool fetch for /api/pools/[id].
 *
 * Returns the pool wrapped in { data } with hydrated matches. Backend
 * scopes to the caller (createdById), so non-creators get 404.
 * Auto-disabled until Privy is ready + authenticated and id is non-empty.
 */

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { getPool } from "@/lib/api/pools";

export function usePool(id: string | undefined | null) {
  const { ready, authenticated, getAccessToken } = usePrivy();

  return useQuery({
    queryKey: ["pool", id],
    queryFn: async ({ signal }) => {
      const token = await getAccessToken();
      return getPool(id as string, {
        token: token ?? undefined,
        signal,
      });
    },
    enabled: ready && authenticated && !!id,
    staleTime: 30_000,
  });
}
