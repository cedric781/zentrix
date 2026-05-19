"use client";

import { useConfirmResult } from "@/hooks/use-confirm-result";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  BetResultClaimSerialized,
  BetSerialized,
} from "@/lib/api/types";

interface Props {
  bet: BetSerialized;
  claim: BetResultClaimSerialized;
}

export function ConfirmOutcomePanel({ bet, claim }: Props) {
  const confirmMutation = useConfirmResult(bet.id);

  // Welke kant heeft proposer geclaimd? Als claimedWinnerId === createdById
  // → creator's kant (creatorSide). Anders → opponent's kant (acceptorSide).
  const claimedSide: "A" | "B" =
    claim.claimedWinnerId === bet.createdById
      ? (bet.creatorSide as "A" | "B")
      : (bet.acceptorSide as "A" | "B");
  const claimedOutcome = claimedSide === "A" ? bet.outcomeA : bet.outcomeB;

  const handleConfirm = () => {
    confirmMutation.mutate({ decision: "CONFIRM_WINNER" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bevestig resultaat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Je tegenpartij claimt:{" "}
          <span className="font-medium text-foreground">{claimedOutcome}</span>{" "}
          heeft gewonnen.
        </p>
        {claim.note && (
          <p className="text-sm text-muted-foreground">
            Toelichting:{" "}
            <span className="text-foreground/80">{claim.note}</span>
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Bij bevestiging worden funds direct vrijgegeven. Dit is definitief.
        </p>

        <Button
          onClick={handleConfirm}
          disabled={confirmMutation.isPending}
          className="w-full"
        >
          {confirmMutation.isPending
            ? "Bevestigen…"
            : `Bevestig: ${claimedOutcome} won`}
        </Button>
      </CardContent>
    </Card>
  );
}
