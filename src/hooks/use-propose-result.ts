"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { proposeResult } from "@/lib/api/bets";
import { ApiError } from "@/lib/api/client";
import type {
  ProposeResultBody,
  ProposeResultResponse,
} from "@/lib/api/types";

export function useProposeResult(betId: string) {
  const qc = useQueryClient();

  return useMutation<ProposeResultResponse, Error, ProposeResultBody>({
    mutationFn: (body) =>
      proposeResult(
        { betId, ...body },
        { idempotencyKey: crypto.randomUUID() },
      ),
    retry: false,
    onSuccess: () => {
      toast.success("Resultaat ingediend");
      qc.invalidateQueries({ queryKey: ["bet", betId] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        switch (err.code) {
          case "BET_INVALID_STATUS":
            toast.error("Bet is niet meer in de juiste staat");
            qc.invalidateQueries({ queryKey: ["bet", betId] });
            return;
          case "BET_NOT_PARTICIPANT":
            toast.error("Je bent geen deelnemer aan deze bet");
            return;
          case "BET_INVALID_INPUT":
            toast.error("Ongeldige invoer");
            return;
          default:
            toast.error("Er ging iets mis");
            console.error("[propose-result]", err);
        }
        return;
      }
      toast.error("Netwerkfout — probeer opnieuw");
      console.error("[propose-result]", err);
    },
  });
}
