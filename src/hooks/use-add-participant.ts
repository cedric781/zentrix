"use client";

/**
 * useAddParticipant — mutation for POST /api/pools/[id]/participants.
 *
 * Owner-only, DRAFT + bracket-not-locked.
 * On success: invalidates ["participants", poolId].
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { addParticipant, type AddParticipantInput } from "@/lib/api/pools";

export function useAddParticipant(poolId: string) {
  const qc = useQueryClient();
  const { getAccessToken } = usePrivy();

  return useMutation({
    mutationFn: async (input: AddParticipantInput) => {
      const token = await getAccessToken();
      const idempotencyKey = crypto.randomUUID();
      return addParticipant(poolId, input, {
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
