"use client";

import { useMemo, useState } from "react";
import { useProposeResult } from "@/hooks/use-propose-result";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { BetSerialized } from "@/lib/api/types";

interface Props {
  bet: BetSerialized;
}

export function ProposeResultCard({ bet }: Props) {
  const [pickedSide, setPickedSide] = useState<"A" | "B" | null>(null);
  const [note, setNote] = useState("");
  const proposeMutation = useProposeResult(bet.id);

  // Side → winnerUserId mapping. creatorSide is wat creator KOOS bij creation.
  // Als pickedSide === creatorSide → creator wint; anders → opponent.
  // opponentUserId kan null zijn op stale state (shouldn't bij ACTIVE; defensive).
  const claimedWinnerId = useMemo<string | null>(() => {
    if (!pickedSide) return null;
    if (pickedSide === bet.creatorSide) return bet.createdById;
    return bet.opponentUserId;
  }, [pickedSide, bet]);

  const canSubmit = claimedWinnerId !== null && !proposeMutation.isPending;

  const handleSubmit = () => {
    if (!claimedWinnerId) return;
    proposeMutation.mutate({
      claimedWinnerId,
      note: note.trim() || undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wie heeft gewonnen?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Selecteer de winnaar. Je tegenpartij moet bevestigen voordat de bet wordt
          afgehandeld.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant={pickedSide === "A" ? "default" : "secondary"}
            onClick={() => setPickedSide("A")}
            disabled={proposeMutation.isPending}
            className="justify-start"
          >
            <span className="mr-2 text-xs text-muted-foreground">A</span>
            {bet.outcomeA}
          </Button>
          <Button
            variant={pickedSide === "B" ? "default" : "secondary"}
            onClick={() => setPickedSide("B")}
            disabled={proposeMutation.isPending}
            className="justify-start"
          >
            <span className="mr-2 text-xs text-muted-foreground">B</span>
            {bet.outcomeB}
          </Button>
        </div>

        <Textarea
          placeholder="Optionele toelichting (max 500 tekens)"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          disabled={proposeMutation.isPending}
          rows={2}
        />

        <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
          {proposeMutation.isPending ? "Indienen…" : "Resultaat indienen"}
        </Button>
      </CardContent>
    </Card>
  );
}
