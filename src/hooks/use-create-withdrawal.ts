"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createWithdrawal, type CreateWithdrawalBody } from "@/lib/api/withdrawals";

/**
 * Mutation hook for submitting a withdrawal.
 *
 * retry: false — financial actions must NEVER auto-retry; a retried request
 * after a transient delivery failure could duplicate a debit.
 *
 * onSuccess: invalidate balance query so the card reflects the debit.
 */
export function useCreateWithdrawal() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateWithdrawalBody) => createWithdrawal(body),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["balance"] });
    },
  });
}
