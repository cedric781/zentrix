"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { getMyBalance } from "@/lib/api/me";

const STALE_MS = 15_000;

export function useBalance() {
  const { ready, authenticated } = usePrivy();

  return useQuery({
    queryKey: ["balance"],
    queryFn: ({ signal }) => getMyBalance({ signal }),
    enabled: ready && authenticated,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
  });
}
