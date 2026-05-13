"use client";

/**
 * useCurrentUser — React Query hook for /api/me.
 *
 * Auto-disabled when Privy session isn't ready or user not authenticated.
 * Returns UserSerialized which has id, email, embeddedWalletAddress.
 *
 * Caller-friendly:
 *   const { data: me, isLoading } = useCurrentUser();
 *   if (me?.id === bet.createdById) ...
 */

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { getMe } from "@/lib/api/me";

export function useCurrentUser() {
  const { ready, authenticated } = usePrivy();

  return useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => getMe({ signal }),
    enabled: ready && authenticated,
    // /me result is fairly stable per session; 5min stale is safe
    staleTime: 5 * 60_000,
  });
}
