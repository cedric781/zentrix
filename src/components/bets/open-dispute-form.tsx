"use client";

import { useState } from "react";
import { AlertTriangle, Clock, DollarSign, Shield } from "lucide-react";
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

export function OpenDisputeForm({ bet, claim }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [altSide, setAltSide] = useState<"A" | "B" | null>(null);
  const confirmMutation = useConfirmResult(bet.id);

  // Welke kant claimde proposer? Disagree = ANDERE kant. User picked explicit
  // (defensive — niet aannemen).
  const claimedSide: "A" | "B" =
    claim.claimedWinnerId === bet.createdById
      ? (bet.creatorSide as "A" | "B")
      : (bet.acceptorSide as "A" | "B");

  const altWinnerId = (side: "A" | "B"): string | null => {
    if (side === bet.creatorSide) return bet.createdById;
    return bet.opponentUserId;
  };

  const handleSubmit = () => {
    if (!altSide) return;
    const winnerId = altWinnerId(altSide);
    if (!winnerId) return;
    confirmMutation.mutate({
      decision: "DISAGREE",
      claimedWinnerId: winnerId,
    });
  };

  if (!expanded) {
    return (
      <Button
        variant="link"
        size="sm"
        onClick={() => setExpanded(true)}
        className="h-auto px-0 text-destructive hover:text-destructive/80"
      >
        <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
        Niet akkoord — open een dispuut
      </Button>
    );
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Open dispuut</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Je bent het oneens met het geclaimde resultaat. Settlement wordt
          gepauzeerd en een review proces gestart.
        </p>

        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <DollarSign className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/60" />
            <span>Funds blijven in escrow tot dispuut is opgelost.</span>
          </div>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/60" />
            <span>
              Beide partijen kunnen bewijs indienen. Review door platform admin.
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/60" />
            <span>Reviewproces duurt doorgaans 24–72 uur.</span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Wie heeft volgens jou gewonnen?
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["A", "B"] as const).map((side) => {
              const outcome = side === "A" ? bet.outcomeA : bet.outcomeB;
              const isClaimed = side === claimedSide;
              return (
                <Button
                  key={side}
                  variant={altSide === side ? "default" : "secondary"}
                  onClick={() => setAltSide(side)}
                  disabled={confirmMutation.isPending}
                  size="sm"
                  className="justify-start"
                >
                  <span className="mr-2 text-xs text-muted-foreground">
                    {side}
                  </span>
                  {outcome}
                  {isClaimed && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (geclaimd)
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!altSide || confirmMutation.isPending}
            className="flex-1"
          >
            {confirmMutation.isPending ? "Indienen…" : "Open dispuut"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setExpanded(false)}
            disabled={confirmMutation.isPending}
          >
            Annuleer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
