"use client";

import { useEffect, useMemo, useState } from "react";
import { useCreateBetState } from "./create-bet-context";
import type {
  SupportedSport,
  TemplateAllowedSource,
} from "@/lib/api/types";
import { SUPPORTED_SPORTS } from "@/lib/api/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Provider = "espn" | "thesportsdb";

const SPORT_LABELS: Record<SupportedSport, string> = {
  football: "Football",
  basketball: "Basketball",
  american_football: "American Football",
  ice_hockey: "Ice Hockey",
  baseball: "Baseball",
  tennis: "Tennis",
  mma: "MMA",
};

// datetime-local emits "YYYY-MM-DDTHH:MM" (no seconds, no tz). Treated as
// local time, converted to UTC ISO. Empty input → empty string so callers
// always see a defined string and can distinguish "untouched" from "partial".
function toIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function ExternalEventPicker() {
  const { template, setExternalRef } = useCreateBetState();

  const allowedSources = useMemo<TemplateAllowedSource[]>(() => {
    const raw = template?.allowedSources;
    return Array.isArray(raw) ? (raw as TemplateAllowedSource[]) : [];
  }, [template?.allowedSources]);

  const providers = useMemo<Provider[]>(() => {
    const seen = new Set<Provider>();
    for (const src of allowedSources) {
      if (src.providerId === "espn" || src.providerId === "thesportsdb") {
        seen.add(src.providerId);
      }
    }
    return seen.size > 0 ? Array.from(seen) : ["espn", "thesportsdb"];
  }, [allowedSources]);

  const [provider, setProvider] = useState<Provider>(providers[0] ?? "espn");
  const [eventId, setEventId] = useState("");
  const [league, setLeague] = useState("");
  const [sport, setSport] = useState<SupportedSport>("football");
  const [eventStartsAt, setEventStartsAt] = useState("");
  const [eventEndsAt, setEventEndsAt] = useState("");

  useEffect(() => {
    if (
      provider &&
      eventId &&
      league &&
      sport &&
      eventStartsAt &&
      eventEndsAt
    ) {
      setExternalRef({
        provider,
        eventId,
        league,
        sport,
        eventStartsAt,
        eventEndsAt,
      });
    } else {
      setExternalRef(null);
    }
  }, [
    provider,
    eventId,
    league,
    sport,
    eventStartsAt,
    eventEndsAt,
    setExternalRef,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Link external event</CardTitle>
        <p className="text-sm text-muted-foreground">
          Auto-resolves the bet from official scoreboards when the event ends.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ref-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as Provider)}
            >
              <SelectTrigger id="ref-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p === "espn" ? "ESPN" : "TheSportsDB"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ref-sport">Sport</Label>
            <Select
              value={sport}
              onValueChange={(v) => setSport(v as SupportedSport)}
            >
              <SelectTrigger id="ref-sport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_SPORTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SPORT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ref-league">League</Label>
          <Input
            id="ref-league"
            value={league}
            onChange={(e) => setLeague(e.target.value)}
            placeholder="e.g. La Liga"
            maxLength={100}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ref-event-id">Event ID</Label>
          <Input
            id="ref-event-id"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="Provider event ID (e.g. 401234567)"
            maxLength={200}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ref-starts">Event starts</Label>
            <Input
              id="ref-starts"
              type="datetime-local"
              onChange={(e) => setEventStartsAt(toIso(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ref-ends">Event ends</Label>
            <Input
              id="ref-ends"
              type="datetime-local"
              onChange={(e) => setEventEndsAt(toIso(e.target.value))}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
