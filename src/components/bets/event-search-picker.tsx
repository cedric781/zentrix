"use client";

/**
 * EventSearchPicker — autocomplete UI for linking a bet to an external
 * sportsbook event. Replaces the manual-entry ExternalEventPicker for
 * categories where automated providers (ESPN, TheSportsDB) cover the sport.
 *
 * Flow:
 *   1. Sport dropdown is pre-populated based on template.category.
 *      - Sport category → football / basketball / american_football / ...
 *      - Combat category → mma only (auto-selected)
 *   2. User types a team name (>= 2 chars). 300ms debounce, then
 *      /api/external-results/search runs in the background.
 *   3. Result list shows up to 10 matches; clicking a result fills
 *      externalRef with all fields the backend requires.
 *
 * Note: provider responses always carry startsAt; endsAt is provider-
 * specific. For MVP we default eventEndsAt = startsAt + 4h (covers most
 * single-match durations). Caller may post-edit if needed; the manual
 * ExternalEventPicker remains available for templates outside the
 * Sport/Combat categories.
 */

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEventSearch } from "@/hooks/use-event-search";
import type { CreateBetExternalRef, SupportedSport } from "@/lib/api/types";
import type { ExternalEventSummary } from "@/lib/api/external-results";
import { DURATION_BY_SPORT_MS } from "@/lib/external-results/types";

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


type Props = {
  category: string;
  value: CreateBetExternalRef | null;
  onChange: (ref: CreateBetExternalRef | null) => void;
  /**
   * Optional hook called with the full event summary (home/away/etc) when
   * the user picks a result. Lets callers auto-fill adjacent form fields
   * — `onChange` only carries the backend-required shape.
   */
  onSelectEvent?: (event: ExternalEventSummary) => void;
};

export function EventSearchPicker({
  category,
  value,
  onChange,
  onSelectEvent,
}: Props) {
  const sportOptions = useMemo(
    () => SPORTS_FOR_CATEGORY[category] ?? [],
    [category],
  );

  const [sport, setSport] = useState<SupportedSport | undefined>(
    value?.sport ?? sportOptions[0],
  );
  const [query, setQuery] = useState("");

  const search = useEventSearch({ query, sport });

  const handleSelect = (event: ExternalEventSummary) => {
    const starts = new Date(event.startsAt);
    const ends = event.endsAt
      ? new Date(event.endsAt)
      : new Date(starts.getTime() + DURATION_BY_SPORT_MS[event.sport]);
    onChange({
      provider: event.provider,
      eventId: event.providerEventId,
      league: event.league,
      sport: event.sport,
      eventStartsAt: starts.toISOString(),
      eventEndsAt: ends.toISOString(),
    });
    onSelectEvent?.(event);
    setQuery("");
  };

  const handleClear = () => {
    onChange(null);
    setQuery("");
  };

  const trimmed = query.trim();
  const results = search.data?.events ?? [];

  if (sportOptions.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No autocomplete sources for category &quot;{category}&quot;. Use the
          manual event linker below.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Link external event</CardTitle>
        <p className="text-sm text-muted-foreground">
          Search the team. We auto-resolve the bet from official scoreboards.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="search-sport">Sport</Label>
          <Select
            value={sport}
            onValueChange={(v) => setSport(v as SupportedSport)}
          >
            <SelectTrigger id="search-sport">
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

        {value ? (
          <SelectedEventCard value={value} onClear={handleClear} />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="search-query">Search team or event</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Lakers, Manchester United"
                maxLength={100}
                className="pl-9"
              />
            </div>

            {trimmed.length > 0 && trimmed.length < 2 && (
              <p className="text-xs text-muted-foreground">
                Type at least 2 characters to search.
              </p>
            )}

            {search.isFetching && (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {search.isError && (
              <Alert variant="destructive">
                <AlertTitle>Search failed</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-4">
                  <span>
                    {search.error instanceof Error
                      ? search.error.message
                      : "Unknown error"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => search.refetch()}
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!search.isFetching &&
              !search.isError &&
              trimmed.length >= 2 &&
              results.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No matches. Try a different name or use the manual linker.
                </p>
              )}

            {results.length > 0 && (
              <ul className="divide-y rounded-md border">
                {results.map((event) => (
                  <li key={`${event.provider}:${event.providerEventId}`}>
                    <button
                      type="button"
                      onClick={() => handleSelect(event)}
                      className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-accent"
                    >
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">
                          {event.homeTeam} vs {event.awayTeam}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {event.league} · {formatDate(event.startsAt)} ·{" "}
                          {event.provider}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SelectedEventCard({
  value,
  onClear,
}: {
  value: CreateBetExternalRef;
  onClear: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Linked event</div>
        <div className="text-xs text-muted-foreground">
          {value.league} · {value.provider} · {formatDate(value.eventStartsAt)}
        </div>
        <div className="text-xs text-muted-foreground">
          Event ID: <span className="font-mono">{value.eventId}</span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        aria-label="Clear linked event"
      >
        <X className="h-4 w-4" />
        <span className="ml-1">Change</span>
      </Button>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 16).replace("T", " ");
}
