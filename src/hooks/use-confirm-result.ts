"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { confirmResult } from "@/lib/api/bets";
import { ApiError } from "@/lib/api/client";
import type {
  ConfirmResultBody,
  ConfirmResultResponse,
} from "@/lib/api/types";

export function useConfirmResult(betId: string) {
  const qc = useQueryClient();

  return useMutation<ConfirmResultResponse, Error, ConfirmResultBody>({
    mutationFn: (body) =>
      confirmResult(
        { betId, ...body },
        { idempotencyKey: crypto.randomUUID() },
      ),
    retry: false,
    onSuccess: (data) => {
      const settled = data.bet.status === "SETTLED";
      const disputed = data.bet.status === "DISPUTED";
      if (settled) toast.success("Bet afgehandeld — payout uitgevoerd");
      else if (disputed) toast("Bet betwist — settlement gepauzeerd");
      else toast.success("Bevestiging opgeslagen");
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
            console.error("[confirm-result]", err);
        }
        return;
      }
      toast.error("Netwerkfout — probeer opnieuw");
      console.error("[confirm-result]", err);
    },
  });
}
