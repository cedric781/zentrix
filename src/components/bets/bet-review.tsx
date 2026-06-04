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

function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function BetReview() {
  const state = useCreateBetState();

  // A path must be chosen — a template OR custom mode — before the preview is
  // meaningful. In custom mode there is no template, so don't gate on it.
  const isFormComplete = Boolean(
    (state.template || state.isCustom) &&
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
          {state.isCustom ? (
            <>
              <strong>Type:</strong> Custom bet (peer-confirmed)
            </>
          ) : (
            <>
              <strong>Template:</strong> {state.template?.name}
            </>
          )}
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
        {state.externalRef && (
          <>
            <div className="pt-2 border-t">
              <strong>Linked event:</strong>{" "}
              {state.externalRef.provider} / {state.externalRef.sport} /{" "}
              {state.externalRef.league} / {state.externalRef.eventId}
            </div>
            <div>
              <strong>Auto-resolves at:</strong>{" "}
              {formatIso(state.externalRef.eventEndsAt)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
