"use client";

import { useCreateBetState } from "./create-bet-context";
import { Button } from "@/components/ui/button";

/**
 * Objective (AUTO_VERIFY) vs subjective (PEER_AGREE) choice.
 *
 * Renders ONLY for auto-resolve-capable templates (canAutoVerify). On
 * non-capable templates the bet is always subjective and no toggle is shown.
 *
 * Switching to subjective clears any linked event (handled by the coupled
 * setSettlementMode in the context) so PEER_AGREE + externalRef can't occur.
 */
export function SettlementModeSelector() {
  const { canAutoVerify, settlementMode, setSettlementMode, externalRef } =
    useCreateBetState();

  if (!canAutoVerify) return null;

  const needsEvent = settlementMode === "AUTO_VERIFY" && !externalRef;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Hoe wordt de uitkomst bepaald?</label>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={settlementMode === "AUTO_VERIFY" ? "default" : "outline"}
          onClick={() => setSettlementMode("AUTO_VERIFY")}
          className="flex-1 h-auto flex-col items-start py-2"
        >
          <span className="font-medium">Objectief</span>
          <span className="text-xs font-normal opacity-80">automatisch via bron</span>
        </Button>
        <Button
          type="button"
          variant={settlementMode === "PEER_AGREE" ? "default" : "outline"}
          onClick={() => setSettlementMode("PEER_AGREE")}
          className="flex-1 h-auto flex-col items-start py-2"
        >
          <span className="font-medium">Subjectief</span>
          <span className="text-xs font-normal opacity-80">jullie beslissen zelf</span>
        </Button>
      </div>
      {needsEvent && (
        <p className="text-xs text-muted-foreground">
          Koppel hieronder een wedstrijd/bron, of schakel naar “jullie beslissen
          zelf”.
        </p>
      )}
    </div>
  );
}
