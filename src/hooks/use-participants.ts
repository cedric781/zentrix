"use client";

/**
 * useParticipants — query for GET /api/pools/[id]/participants.
 *
 * Returns the participants list (sorted by seed ASC, max 64).
 * Public-readable for OPEN+; owner-only for DRAFT pools (backend gated).
 * Auto-disabled until Privy is ready + authenticated and poolId is non-empty.
 */

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { listParticipants } from "@/lib/api/pools";

export function useParticipants(poolId: string | undefined | null) {
  const { ready, authenticated, getAccessToken } = usePrivy();

  return useQuery({
    queryKey: ["participants", poolId],
    queryFn: async ({ signal }) => {
      const token = await getAccessToken();
      return listParticipants(poolId as string, {
        token: token ?? undefined,
        signal,
      });
    },
    enabled: ready && authenticated && !!poolId,
    staleTime: 30_000,
  });
}
