"use client";

import { useCreateBetState } from "./create-bet-context";
import { SettlementModeSelector } from "./settlement-mode-selector";
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
import type { ExternalEventSummary } from "@/lib/api/external-results";

const HOUR_PRESETS = [
  { value: 24, label: "24 hours" },
  { value: 48, label: "2 days" },
  { value: 72, label: "3 days" },
  { value: 168, label: "1 week" },
] as const;

const EXPIRY_PRESET_VALUES = HOUR_PRESETS.map((p) => p.value);
const DEFAULT_EXPIRY_HOURS = HOUR_PRESETS[0].value;
const EXPIRY_BUFFER_HOURS = 1;
const MS_PER_HOUR = 60 * 60 * 1000;

export function BetForm() {
  const state = useCreateBetState();

  // Render once a path is chosen: a template, OR custom (free) mode. In custom
  // mode there is no template, so every state.template.* read below MUST be
  // null-safe — that branch sets template=null + PEER_AGREE.
  if (!state.template && !state.isCustom) {
    return (
      <Alert>
        <AlertDescription>
          Pick a template above — or make your own — to start filling in your bet.
        </AlertDescription>
      </Alert>
    );
  }

  // null-safe: custom mode has no template. allowedSources only feeds the
  // event picker, which never renders in custom mode (PEER_AGREE → showPicker false).
  const allowedSourcesRaw = state.template?.allowedSources;
  const allowedSources = Array.isArray(allowedSourcesRaw)
    ? (allowedSourcesRaw as TemplateAllowedSource[])
    : [];
  // Picker visibility is now driven by the chosen settlement mode, not the
  // template capability directly. The context guarantees AUTO_VERIFY is only
  // selectable on capable templates (canAutoVerify), so allowedSources is
  // non-empty whenever this is true. Custom mode is PEER_AGREE → always false.
  const showPicker = state.settlementMode === "AUTO_VERIFY";
  // EventSearchPicker covers Sport+Combat via ESPN/TheSportsDB. Other
  // auto-resolve categories (Esports/Games) fall back to the manual picker.
  // null-safe: "" in custom mode (picker doesn't render, so unused).
  const category = state.template?.category ?? "";
  const useAutocompletePicker = category === "Sport" || category === "Combat";
  // Title is pre-filled with template.name when a template is picked; treat
  // that as "still at default" for the auto-fill empty-check. null-safe: ""
  // in custom mode (autofill only fires from the event picker, which is hidden).
  const templateName = state.template?.name ?? "";

  // Custom (free) bets aren't sports-shaped, so the sports-flavoured example
  // placeholders would mislead. Swap them for free-form hints in custom mode.
  const titlePlaceholder = state.isCustom
    ? "bv. Wie haalt deze week de meeste stappen?"
    : "e.g. Real Madrid vs Barcelona";
  const outcomeAPlaceholder = state.isCustom ? "bv. Ik" : "e.g. Real Madrid wins";
  const outcomeBPlaceholder = state.isCustom ? "bv. Jij" : "e.g. Barcelona wins";

  const handleAutofill = (event: ExternalEventSummary) => {
    if (!state.title || state.title === templateName) {
      state.setTitle(`${event.homeTeam} vs ${event.awayTeam}`);
    }
    if (!state.outcomeA) {
      state.setOutcomeA(`${event.homeTeam} wins`);
    }
    if (!state.outcomeB) {
      state.setOutcomeB(`${event.awayTeam} wins`);
    }
    if (state.expiresInHours === DEFAULT_EXPIRY_HOURS) {
      const eventStartsMs = new Date(event.startsAt).getTime();
      if (!Number.isNaN(eventStartsMs)) {
        const hoursUntil =
          Math.ceil((eventStartsMs - Date.now()) / MS_PER_HOUR) +
          EXPIRY_BUFFER_HOURS;
        if (hoursUntil > DEFAULT_EXPIRY_HOURS) {
          const snapped =
            EXPIRY_PRESET_VALUES.find((p) => p >= hoursUntil) ??
            EXPIRY_PRESET_VALUES[EXPIRY_PRESET_VALUES.length - 1];
          state.setExpiresInHours(snapped);
        }
      }
    }
  };

  return (
    <div className="space-y-4">
    <SettlementModeSelector />
    {showPicker && (
      <div className="space-y-1">
        <label className="text-sm font-medium">
          Wedstrijd / bron{" "}
          <span className="text-muted-foreground font-normal">
            (verplicht voor objectief)
          </span>
        </label>
        {useAutocompletePicker ? (
          <EventSearchPicker
            category={category}
            value={state.externalRef}
            onChange={state.setExternalRef}
            onSelectEvent={handleAutofill}
          />
        ) : (
          <ExternalEventPicker
            allowedSources={allowedSources}
            category={category}
            value={state.externalRef}
            onChange={state.setExternalRef}
          />
        )}
      </div>
    )}
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
            placeholder={titlePlaceholder}
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
              placeholder={outcomeAPlaceholder}
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
              placeholder={outcomeBPlaceholder}
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
    </div>
  );
}
