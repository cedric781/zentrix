"use client";

/**
 * useCreatePool — React Query mutation for POST /api/pools.
 *
 * Generates a fresh UUIDv4 Idempotency-Key per submission attempt.
 * Server validates UUIDv4 format and dedupes within retry window.
 *
 * retry: false — write action, caller-managed retry only.
 * On success: invalidates ["pools"] so the listing refreshes.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { createPool, type CreatePoolInput } from "@/lib/api/pools";

export function useCreatePool() {
  const qc = useQueryClient();
  const { getAccessToken } = usePrivy();

  return useMutation({
    mutationFn: async (input: CreatePoolInput) => {
      const token = await getAccessToken();
      const idempotencyKey = crypto.randomUUID();
      return createPool(input, {
        token: token ?? undefined,
        idempotencyKey,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pools"] });
    },
    retry: false,
  });
}
