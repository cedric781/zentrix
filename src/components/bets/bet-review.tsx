"use client";

import { useCreateBetState } from "./create-bet-context";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

function formatExpires(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    if (days === 7) return "1 week";
    return `${days} day${days > 1 ? "s" : ""}`;
  }
  return `${hours} hours`;
}

export function BetReview() {
  const state = useCreateBetState();

  const isFormComplete = Boolean(
    state.template &&
      state.title &&
      state.outcomeA &&
      state.outcomeB &&
      state.stakeUnits,
  );

  if (!isFormComplete) {
    return (
      <Alert>
        <AlertDescription>
          Fill in all fields above to see your bet preview.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3 text-sm">
        <div>
          <strong>Template:</strong> {state.template?.name}
        </div>
        <div>
          <strong>Title:</strong> {state.title}
        </div>
        <div>
          <strong>Outcome A:</strong> {state.outcomeA}
        </div>
        <div>
          <strong>Outcome B:</strong> {state.outcomeB}
        </div>
        <div>
          <strong>Your side:</strong> {state.side} (
          {state.side === "A" ? state.outcomeA : state.outcomeB})
        </div>
        <div>
          <strong>Stake:</strong> {state.stakeUnits} USDC
        </div>
        <div>
          <strong>Expires in:</strong> {formatExpires(state.expiresInHours)}
        </div>
      </CardContent>
    </Card>
  );
}
