"use client";

/**
 * useRemoveParticipant — mutation for DELETE /api/pools/[id]/participants/[participantId].
 *
 * Owner-only, DRAFT + bracket-not-locked.
 * On success: invalidates ["participants", poolId].
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { removeParticipant } from "@/lib/api/pools";

export function useRemoveParticipant(poolId: string) {
  const qc = useQueryClient();
  const { getAccessToken } = usePrivy();

  return useMutation({
    mutationFn: async (participantId: string) => {
      const token = await getAccessToken();
      const idempotencyKey = crypto.randomUUID();
      return removeParticipant(poolId, participantId, {
        token: token ?? undefined,
        idempotencyKey,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants", poolId] });
    },
    retry: false,
  });
}
