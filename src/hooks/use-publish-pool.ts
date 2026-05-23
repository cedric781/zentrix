"use client";

/**
 * usePublishPool — React Query mutation for POST /api/pools/[id]/publish.
 *
 * Transitions pool DRAFT → OPEN server-side. Owner-only.
 *
 * retry: false — state-change action, no auto-retry.
 * On success: invalidates ["pool", poolId] (detail) + ["pools"] (lists).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { publishPool } from "@/lib/api/pools";

export function usePublishPool(poolId: string) {
  const qc = useQueryClient();
  const { getAccessToken } = usePrivy();

  return useMutation({
    mutationFn: async () => {
      const token = await getAccessToken();
      const idempotencyKey = crypto.randomUUID();
      return publishPool(poolId, {
        token: token ?? undefined,
        idempotencyKey,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pool", poolId] });
      qc.invalidateQueries({ queryKey: ["pools"] });
    },
    retry: false,
  });
}
