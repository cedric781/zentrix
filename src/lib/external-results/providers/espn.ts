import type {
  ExternalResultProvider,
  FetchEventInput,
  ExternalEventResult,
  SearchEventsParams,
  ExternalEventSummary,
} from "../types";
import { providerFetch, ProviderError } from "../types";
import type { SupportedSport } from "@/lib/api/types";

/**
 * ESPN league mapping. Sport+league string → ESPN URL path.
 * Cross-reference: https://site.api.espn.com/apis/site/v2/sports
 */
const ESPN_PATHS: Record<string, string> = {
  // Football (soccer)
  "football:premier-league": "soccer/eng.1",
  "football:la-liga": "soccer/esp.1",
  "football:bundesliga": "soccer/ger.1",
  "football:serie-a": "soccer/ita.1",
  "football:ligue-1": "soccer/fra.1",
  "football:eredivisie": "soccer/ned.1",
  "football:champions-league": "soccer/uefa.champions",
  "football:europa-league": "soccer/uefa.europa",
  "football:mls": "soccer/usa.1",
  // US sports
  "basketball:nba": "basketball/nba",
  "american_football:nfl": "football/nfl",
  "ice_hockey:nhl": "hockey/nhl",
  "baseball:mlb": "baseball/mlb",
  // Combat sports
  "mma:ufc": "mma/ufc",
};

// Display labels for the league portion of ESPN_PATHS keys. Used to populate
// the league field on ExternalEventSummary when scoreboard scan finds a match.
const LEAGUE_KEY_LABELS: Record<string, string> = {
  "premier-league": "Premier League",
  "la-liga": "La Liga",
  bundesliga: "Bundesliga",
  "serie-a": "Serie A",
  "ligue-1": "Ligue 1",
  eredivisie: "Eredivisie",
  "champions-league": "Champions League",
  "europa-league": "Europa League",
  mls: "MLS",
  nba: "NBA",
  nfl: "NFL",
  nhl: "NHL",
  mlb: "MLB",
  ufc: "UFC",
};

const ESPN_USER_AGENT = "Zentrix/1.0";
const SEARCH_TIMEOUT_MS = 8000;
const SCOREBOARD_LOOKAHEAD_DAYS = 14;
const SEARCH_RESULT_LIMIT = 10;

type EspnScoreboardListResponse = {
  events?: Array<{
    id: string;
    date?: string;
    competitions?: Array<{
      date?: string;
      competitors?: Array<{
        homeAway: "home" | "away";
        team?: { displayName?: string; name?: string };
      }>;
    }>;
  }>;
};

/**
 * ESPN's competition response shape (partial — alleen wat we gebruiken).
 */
export type EspnEventResponse = {
  status?: {
    type?: { state?: string; completed?: boolean; description?: string };
  };
  competitions?: Array<{
    competitors?: Array<{
      homeAway: "home" | "away";
      score?: string;
      team?: { displayName?: string; name?: string };
    }>;
    status?: {
      type?: { state?: string; completed?: boolean; description?: string };
    };
    date?: string;
  }>;
  date?: string;
};

export class EspnProvider implements ExternalResultProvider {
  readonly name = "espn" as const;

  async fetchEvent(input: FetchEventInput): Promise<ExternalEventResult> {
    const key = `${input.sport}:${input.league}`;
    const path = ESPN_PATHS[key];
    if (!path) {
      throw new ProviderError(
        "espn",
        "PARSE_ERROR",
        `No ESPN mapping for ${key}`,
      );
    }

    const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard/${encodeURIComponent(input.eventId)}`;
    const raw = await providerFetch("espn", url);

    if (raw === null) {
      return { kind: "not_found" };
    }

    return parseEspnResponse(raw as EspnEventResponse);
  }

  /**
   * P40 autocomplete. ESPN has no proper search endpoint, so we:
   *   1. Scan scoreboard for every league mapped to `sport` over a 14-day window
   *   2. Client-side filter on team-name substring (case-insensitive)
   *   3. Run all league scans in parallel
   *   4. Dedupe on ESPN event id
   *   5. Cap at 10 results
   *
   * Errors per league are logged to console.warn and treated as empty list —
   * one failing league does not kill the whole search.
   */
  async searchEvents(
    params: SearchEventsParams,
  ): Promise<ExternalEventSummary[]> {
    const query = params.query.trim().toLowerCase();
    if (query.length < 2) return [];

    const entries = pathsForSport(params.sport, params.league);
    if (entries.length === 0) return [];

    const dateRange = formatDateRange(SCOREBOARD_LOOKAHEAD_DAYS);

    const tasks = entries.map(({ leagueKey, path }) =>
      scanLeagueScoreboard({
        sport: params.sport,
        leagueKey,
        path,
        dateRange,
        query,
      }),
    );

    const settled = await Promise.allSettled(tasks);
    const all: ExternalEventSummary[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        all.push(...result.value);
      }
    }

    // Dedupe by providerEventId (ESPN ids are globally unique).
    const byId = new Map<string, ExternalEventSummary>();
    for (const ev of all) {
      if (!byId.has(ev.providerEventId)) byId.set(ev.providerEventId, ev);
    }

    return Array.from(byId.values())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, SEARCH_RESULT_LIMIT);
  }
}

function pathsForSport(
  sport: SupportedSport,
  leagueFilter: string | undefined,
): Array<{ leagueKey: string; path: string }> {
  const prefix = `${sport}:`;
  const out: Array<{ leagueKey: string; path: string }> = [];
  for (const [key, path] of Object.entries(ESPN_PATHS)) {
    if (!key.startsWith(prefix)) continue;
    const leagueKey = key.slice(prefix.length);
    if (leagueFilter && leagueFilter !== leagueKey) continue;
    out.push({ leagueKey, path });
  }
  return out;
}

function formatDateRange(daysAhead: number): string {
  const start = new Date();
  const end = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${fmt(start)}-${fmt(end)}`;
}

async function scanLeagueScoreboard(args: {
  sport: SupportedSport;
  leagueKey: string;
  path: string;
  dateRange: string;
  query: string;
}): Promise<ExternalEventSummary[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${args.path}/scoreboard?dates=${args.dateRange}`;
  let raw: unknown;
  try {
    raw = await providerFetch("espn", url, {
      headers: { "User-Agent": ESPN_USER_AGENT },
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn(`espn searchEvents: ${args.path} failed: ${msg}`);
    return [];
  }

  if (raw === null) return [];
  const data = raw as EspnScoreboardListResponse;
  const events = data.events ?? [];

  const out: ExternalEventSummary[] = [];
  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    const homeName = home?.team?.displayName ?? home?.team?.name;
    const awayName = away?.team?.displayName ?? away?.team?.name;
    if (!homeName || !awayName) continue;

    const hay = `${homeName} ${awayName}`.toLowerCase();
    if (!hay.includes(args.query)) continue;

    const startIso = comp.date ?? event.date;
    if (!startIso) continue;

    const leagueLabel = LEAGUE_KEY_LABELS[args.leagueKey] ?? args.leagueKey;
    const datePart = startIso.slice(0, 10);
    out.push({
      provider: "espn",
      providerEventId: event.id,
      sport: args.sport,
      league: args.leagueKey,
      homeTeam: homeName,
      awayTeam: awayName,
      startsAt: new Date(startIso).toISOString(),
      label: `${homeName} vs ${awayName} — ${leagueLabel} — ${datePart}`,
    });
  }
  return out;
}

export function parseEspnResponse(data: EspnEventResponse): ExternalEventResult {
  const comp = data.competitions?.[0];
  if (!comp) {
    return { kind: "not_found" };
  }

  const state = comp.status?.type?.state ?? data.status?.type?.state;
  const completed = comp.status?.type?.completed ?? data.status?.type?.completed;

  if (state === "pre") return { kind: "scheduled" };
  if (state === "in") return { kind: "in_progress" };

  if (state === "post" && completed) {
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    if (!home || !away) {
      throw new ProviderError(
        "espn",
        "PARSE_ERROR",
        "ESPN response missing home/away competitor",
      );
    }
    const homeName = home.team?.displayName ?? home.team?.name;
    const awayName = away.team?.displayName ?? away.team?.name;
    if (!homeName || !awayName) {
      throw new ProviderError(
        "espn",
        "PARSE_ERROR",
        "ESPN response missing team names",
      );
    }

    const homeScore = parseInt(home.score ?? "", 10);
    const awayScore = parseInt(away.score ?? "", 10);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
      throw new ProviderError(
        "espn",
        "PARSE_ERROR",
        "ESPN response has non-numeric score",
      );
    }

    const finishedAtStr = comp.date ?? data.date;
    const finishedAt = finishedAtStr ? new Date(finishedAtStr) : new Date();

    if (homeScore === awayScore) {
      return {
        kind: "draw",
        homeTeam: homeName,
        awayTeam: awayName,
        homeScore,
        awayScore,
        finishedAt,
      };
    }
    return {
      kind: "completed",
      homeTeam: homeName,
      awayTeam: awayName,
      homeScore,
      awayScore,
      finishedAt,
    };
  }

  // ESPN sometimes uses descriptions for postponed/cancelled
  const desc =
    comp.status?.type?.description?.toLowerCase() ??
    data.status?.type?.description?.toLowerCase() ??
    "";
  if (desc.includes("postpone")) return { kind: "postponed", reason: desc };
  if (desc.includes("cancel")) return { kind: "cancelled", reason: desc };

  return { kind: "scheduled" };
}
