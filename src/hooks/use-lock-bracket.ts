"use client";

/**
 * useLockBracket — mutation for POST /api/pools/[id]/lock-bracket.
 *
 * Owner-only, DRAFT + bracket-not-locked. Generates match tree from
 * participants, sets tournamentFormat + bracketLockedAt on pool.
 *
 * Invalidates: ["participants", poolId] (seeds re-read after structure change),
 * ["pool", poolId] (pool detail: matches + tournamentFormat + bracketLockedAt),
 * ["pools"] (listing: format column may appear).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { lockBracket, type LockBracketInput } from "@/lib/api/pools";

export function useLockBracket(poolId: string) {
  const qc = useQueryClient();
  const { getAccessToken } = usePrivy();

  return useMutation({
    mutationFn: async (input: LockBracketInput) => {
      const token = await getAccessToken();
      const idempotencyKey = crypto.randomUUID();
      return lockBracket(poolId, input, {
        token: token ?? undefined,
        idempotencyKey,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants", poolId] });
      qc.invalidateQueries({ queryKey: ["pool", poolId] });
      qc.invalidateQueries({ queryKey: ["pools"] });
    },
    retry: false,
  });
}
