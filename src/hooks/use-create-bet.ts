"use client";

/**
 * useCreateBet — React Query mutation for POST /api/bets.
 *
 * Generates a fresh UUIDv4 Idempotency-Key per submission attempt.
 * Server validates UUIDv4 format and dedupes within retry window.
 *
 * retry: false — financial action, never auto-retry to avoid double-debit.
 * On success: invalidates ["bets"] queries so /feed refreshes.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBet, type CreateBetInput } from "@/lib/api/bets";

export function useCreateBet() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBetInput) => {
      const idempotencyKey = crypto.randomUUID();
      return createBet(input, { idempotencyKey });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bets"] });
    },
    retry: false,
  });
}
