"use client";

import { useState } from "react";
import type {
  CreateBetExternalRef,
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

type Props = {
  allowedSources: TemplateAllowedSource[];
  category: string;
  value: CreateBetExternalRef | null;
  onChange: (ref: CreateBetExternalRef | null) => void;
};

const SPORT_LABELS: Record<SupportedSport, string> = {
  football: "Football",
  basketball: "Basketball",
  american_football: "American Football",
  ice_hockey: "Ice Hockey",
  baseball: "Baseball",
  tennis: "Tennis",
  mma: "MMA",
};

const SPORTS_FOR_CATEGORY: Record<string, SupportedSport[]> = {
  Sport: [
    "football",
    "basketball",
    "american_football",
    "ice_hockey",
    "baseball",
    "tennis",
  ],
  Combat: ["mma"],
};

const LEAGUES_FOR_SPORT: Record<SupportedSport, string[]> = {
  football: [
    "Premier League",
    "La Liga",
    "Bundesliga",
    "Serie A",
    "Ligue 1",
    "Eredivisie",
    "Champions League",
  ],
  basketball: ["NBA", "EuroLeague"],
  american_football: ["NFL"],
  ice_hockey: ["NHL"],
  baseball: ["MLB"],
  tennis: ["ATP", "WTA"],
  mma: ["UFC", "Bellator"],
};

function isoToDatetimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExternalEventPicker({
  allowedSources,
  category,
  value,
  onChange,
}: Props) {
  const providers = ((): Provider[] => {
    const seen = new Set<Provider>();
    for (const src of allowedSources) {
      if (src.providerId === "espn" || src.providerId === "thesportsdb") {
        seen.add(src.providerId);
      }
    }
    return seen.size > 0 ? Array.from(seen) : ["espn", "thesportsdb"];
  })();

  const sportOptions: SupportedSport[] =
    SPORTS_FOR_CATEGORY[category] ?? [...SUPPORTED_SPORTS];

  const [provider, setProvider] = useState<Provider>(
    value?.provider ?? providers[0] ?? "espn",
  );
  const [sport, setSport] = useState<SupportedSport>(
    value?.sport ?? sportOptions[0] ?? "football",
  );
  const [league, setLeague] = useState(value?.league ?? "");
  const [eventId, setEventId] = useState(value?.eventId ?? "");
  const [startsLocal, setStartsLocal] = useState(
    isoToDatetimeLocal(value?.eventStartsAt),
  );
  const [endsLocal, setEndsLocal] = useState(
    isoToDatetimeLocal(value?.eventEndsAt),
  );

  const leagues = LEAGUES_FOR_SPORT[sport] ?? [];

  function emit(next: {
    provider: Provider;
    sport: SupportedSport;
    league: string;
    eventId: string;
    startsLocal: string;
    endsLocal: string;
  }) {
    if (
      !next.provider ||
      !next.sport ||
      !next.league ||
      !next.eventId ||
      !next.startsLocal ||
      !next.endsLocal
    ) {
      onChange(null);
      return;
    }
    const startsDate = new Date(next.startsLocal);
    const endsDate = new Date(next.endsLocal);
    if (
      Number.isNaN(startsDate.getTime()) ||
      Number.isNaN(endsDate.getTime())
    ) {
      onChange(null);
      return;
    }
    onChange({
      provider: next.provider,
      sport: next.sport,
      league: next.league,
      eventId: next.eventId,
      eventStartsAt: startsDate.toISOString(),
      eventEndsAt: endsDate.toISOString(),
    });
  }

  const onProvider = (p: Provider) => {
    setProvider(p);
    emit({ provider: p, sport, league, eventId, startsLocal, endsLocal });
  };

  const onSport = (s: SupportedSport) => {
    const nextLeagues = LEAGUES_FOR_SPORT[s] ?? [];
    const nextLeague = nextLeagues.includes(league) ? league : "";
    setSport(s);
    setLeague(nextLeague);
    emit({
      provider,
      sport: s,
      league: nextLeague,
      eventId,
      startsLocal,
      endsLocal,
    });
  };

  const onLeague = (l: string) => {
    setLeague(l);
    emit({ provider, sport, league: l, eventId, startsLocal, endsLocal });
  };

  const onEventId = (v: string) => {
    setEventId(v);
    emit({ provider, sport, league, eventId: v, startsLocal, endsLocal });
  };

  const onStarts = (v: string) => {
    setStartsLocal(v);
    emit({ provider, sport, league, eventId, startsLocal: v, endsLocal });
  };

  const onEnds = (v: string) => {
    setEndsLocal(v);
    emit({ provider, sport, league, eventId, startsLocal, endsLocal: v });
  };

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
              onValueChange={(v) => onProvider(v as Provider)}
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
              onValueChange={(v) => onSport(v as SupportedSport)}
            >
              <SelectTrigger id="ref-sport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sportOptions.map((s) => (
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
          <Select value={league} onValueChange={onLeague}>
            <SelectTrigger id="ref-league">
              <SelectValue placeholder="Select a league" />
            </SelectTrigger>
            <SelectContent>
              {leagues.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ref-event-id">Event ID</Label>
          <Input
            id="ref-event-id"
            value={eventId}
            onChange={(e) => onEventId(e.target.value)}
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
              value={startsLocal}
              onChange={(e) => onStarts(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ref-ends">Event ends</Label>
            <Input
              id="ref-ends"
              type="datetime-local"
              value={endsLocal}
              onChange={(e) => onEnds(e.target.value)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
