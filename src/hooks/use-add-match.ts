"use client";

/**
 * useAddMatch — React Query mutation for POST /api/pools/[id]/matches.
 *
 * Adds a match to an OPEN pool. Owner-only.
 *
 * retry: false — write action, no auto-retry.
 * On success: invalidates ["pool", poolId] so the detail page's matches
 * array refetches.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { addMatchToPool, type AddMatchInput } from "@/lib/api/pools";

export function useAddMatch(poolId: string) {
  const qc = useQueryClient();
  const { getAccessToken } = usePrivy();

  return useMutation({
    mutationFn: async (input: AddMatchInput) => {
      const token = await getAccessToken();
      const idempotencyKey = crypto.randomUUID();
      return addMatchToPool(poolId, input, {
        token: token ?? undefined,
        idempotencyKey,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pool", poolId] });
    },
    retry: false,
  });
}
