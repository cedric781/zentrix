"use client";

import { useCreateBetState } from "./create-bet-context";
import { ExternalEventPicker } from "./external-event-picker";
import { EventSearchPicker } from "./event-search-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { TemplateAllowedSource } from "@/lib/api/types";

const HOUR_PRESETS = [
  { value: 24, label: "24 hours" },
  { value: 48, label: "2 days" },
  { value: 72, label: "3 days" },
  { value: 168, label: "1 week" },
] as const;

export function BetForm() {
  const state = useCreateBetState();

  if (!state.template) {
    return (
      <Alert>
        <AlertDescription>
          Pick a template above to start filling in your bet.
        </AlertDescription>
      </Alert>
    );
  }

  const allowedSourcesRaw = state.template.allowedSources;
  const allowedSources = Array.isArray(allowedSourcesRaw)
    ? (allowedSourcesRaw as TemplateAllowedSource[])
    : [];
  const showPicker =
    state.template.supportsAutoResolve === true && allowedSources.length > 0;
  // EventSearchPicker covers Sport+Combat via ESPN/TheSportsDB. Other
  // auto-resolve categories (Esports/Games) fall back to the manual picker.
  const category = state.template.category;
  const useAutocompletePicker = category === "Sport" || category === "Combat";

  return (
    <div className="space-y-4">
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium">
            Title
          </label>
          <Input
            id="title"
            value={state.title}
            onChange={(e) => state.setTitle(e.target.value)}
            placeholder="e.g. Real Madrid vs Barcelona"
            maxLength={200}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="outcomeA" className="text-sm font-medium">
              Outcome A
            </label>
            <Input
              id="outcomeA"
              value={state.outcomeA}
              onChange={(e) => state.setOutcomeA(e.target.value)}
              placeholder="e.g. Real Madrid wins"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="outcomeB" className="text-sm font-medium">
              Outcome B
            </label>
            <Input
              id="outcomeB"
              value={state.outcomeB}
              onChange={(e) => state.setOutcomeB(e.target.value)}
              placeholder="e.g. Barcelona wins"
              maxLength={100}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Your side</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={state.side === "A" ? "default" : "outline"}
              onClick={() => state.setSide("A")}
              className="flex-1"
            >
              A: {state.outcomeA || "Outcome A"}
            </Button>
            <Button
              type="button"
              variant={state.side === "B" ? "default" : "outline"}
              onClick={() => state.setSide("B")}
              className="flex-1"
            >
              B: {state.outcomeB || "Outcome B"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="stake" className="text-sm font-medium">
            Stake (USDC)
          </label>
          <Input
            id="stake"
            type="number"
            min="1"
            step="0.01"
            value={state.stakeUnits}
            onChange={(e) => state.setStakeUnits(e.target.value)}
            placeholder="25.00"
          />
          <p className="text-xs text-muted-foreground">
            Both sides stake the same amount. Winner takes the pot.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="expires" className="text-sm font-medium">
            Expires in
          </label>
          <Select
            value={String(state.expiresInHours)}
            onValueChange={(v) => state.setExpiresInHours(Number(v))}
          >
            <SelectTrigger id="expires">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOUR_PRESETS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            If no one accepts within this time, the bet expires.
          </p>
        </div>
      </CardContent>
    </Card>
    {showPicker && useAutocompletePicker && (
      <EventSearchPicker
        category={category}
        value={state.externalRef}
        onChange={state.setExternalRef}
      />
    )}
    {showPicker && !useAutocompletePicker && (
      <ExternalEventPicker
        allowedSources={allowedSources}
        category={category}
        value={state.externalRef}
        onChange={state.setExternalRef}
      />
    )}
    </div>
  );
}
