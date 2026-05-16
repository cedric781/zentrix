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
const SEARCH_URL = "https://site.api.espn.com/apis/search/v2";
const SEARCH_TIMEOUT_MS = 8000;
const SCOREBOARD_LOOKAHEAD_DAYS = 14;
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_API_PER_QUERY_LIMIT = 8;
const DEFAULT_DURATION_HOURS = 4;

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

type EspnSearchContent = {
  eventId: string;
  displayName: string;
  subtitle?: string;
  date?: string;
};

type EspnSearchResponse = {
  totalFound?: number;
  results?: Array<{ type: string; contents?: EspnSearchContent[] }>;
};

// Sport filter: subtitle keywords that mean "wrong sport for this query".
// ESPN's search API mixes sports; the regex below skips obvious mismatches.
// Per-sport regex follows Wager pattern (port: negative filter on subtitle).
const ESPN_WRONG_SPORT_PATTERNS: Record<SupportedSport, RegExp> = {
  football: /\b(nba|nfl|mlb|nhl|wnba|tennis|mma|ufc)\b/i,
  basketball: /\b(soccer|mlb|nhl|nfl|tennis|mma|ufc)\b/i,
  american_football: /\b(nba|mlb|nhl|soccer|tennis|mma|ufc|wnba)\b/i,
  ice_hockey: /\b(nba|nfl|mlb|soccer|tennis|mma|ufc|wnba)\b/i,
  baseball: /\b(nba|nfl|nhl|soccer|tennis|mma|ufc|wnba)\b/i,
  tennis: /\b(nba|nfl|mlb|nhl|soccer|mma|ufc|wnba)\b/i,
  mma: /\b(nba|nfl|mlb|nhl|soccer|tennis|wnba)\b/i,
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
   * P40 autocomplete (Wager pattern compleet): run two strategies in parallel,
   * then merge + dedupe.
   *
   *   1. searchViaApi — ESPN's `apis/search/v2` endpoint. Catches teams that
   *      fall outside the scoreboard 14-day window (long-tail upcoming matches).
   *   2. searchViaScoreboard — per-league scoreboard scan with team-name match.
   *
   * Results merge with API-first preference (it tends to return more
   * informative subtitles), dedupe by ESPN event id, cap at 10.
   */
  async searchEvents(
    params: SearchEventsParams,
  ): Promise<ExternalEventSummary[]> {
    const query = params.query.trim();
    if (query.length < 2) return [];

    const [apiResults, scoreboardResults] = await Promise.all([
      this.searchViaApi(query, params.sport),
      this.searchViaScoreboard(query, params.sport, params.league),
    ]);

    const seen = new Set<string>();
    const merged: ExternalEventSummary[] = [];
    for (const ev of [...apiResults, ...scoreboardResults]) {
      if (seen.has(ev.providerEventId)) continue;
      seen.add(ev.providerEventId);
      merged.push(ev);
      if (merged.length >= SEARCH_RESULT_LIMIT) break;
    }
    console.log(
      `[ESPN] query="${query}" sport="${params.sport}" api=${apiResults.length} scoreboard=${scoreboardResults.length} merged=${merged.length}`,
    );
    return merged;
  }

  /**
   * ESPN search API — undocumented `apis/search/v2` endpoint. Returns a
   * cross-sport "upcoming" block; we filter to our requested sport via
   * subtitle regex (best-effort, ESPN does not echo a structured sport tag).
   */
  private async searchViaApi(
    query: string,
    sport: SupportedSport,
  ): Promise<ExternalEventSummary[]> {
    try {
      const qs = new URLSearchParams({
        query,
        limit: "30",
        type: "upcoming",
      });
      const url = `${SEARCH_URL}?${qs.toString()}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: {
          "User-Agent": ESPN_USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(
          `[ESPN] searchViaApi HTTP ${res.status} for query="${query}"`,
        );
        return [];
      }
      const data = (await res.json()) as EspnSearchResponse;
      const upcomingBlock = data.results?.find((r) => r.type === "upcoming");
      const items = upcomingBlock?.contents ?? [];
      const wrongSport = ESPN_WRONG_SPORT_PATTERNS[sport];
      const q = query.toLowerCase();
      const seen = new Set<string>();
      const events: ExternalEventSummary[] = [];

      for (const item of items) {
        const name = item.displayName ?? "";
        if (name.startsWith("En Español-")) continue;
        if (seen.has(item.eventId)) continue;
        seen.add(item.eventId);

        const subtitle = item.subtitle ?? "";
        if (wrongSport.test(subtitle)) continue;

        const nameClean = name.replace(/ \(.*\)$/, "").trim();
        const sep = nameClean.includes(" vs. ") ? " vs. " : " vs ";
        const parts = nameClean.split(sep);
        if (parts.length !== 2) continue;

        const homeTeam = parts[0].trim();
        const awayTeam = parts[1].trim();
        if (!homeTeam || !awayTeam) continue;
        if (
          !homeTeam.toLowerCase().includes(q) &&
          !awayTeam.toLowerCase().includes(q)
        ) {
          continue;
        }

        const league = subtitle.includes("•")
          ? (subtitle.split("•")[1]?.trim() ?? subtitle)
          : subtitle;
        const startsAt = item.date ? new Date(item.date) : new Date();
        const endsAt = new Date(
          startsAt.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000,
        );

        events.push({
          provider: "espn",
          providerEventId: item.eventId,
          sport,
          league,
          homeTeam,
          awayTeam,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          label: `${homeTeam} vs ${awayTeam} — ${league} — ${startsAt.toLocaleDateString("en-GB")}`,
        });

        if (events.length >= SEARCH_API_PER_QUERY_LIMIT) break;
      }
      return events;
    } catch (err) {
      console.error(`[ESPN] searchViaApi error for query="${query}":`, err);
      return [];
    }
  }

  /**
   * Scoreboard scan — fan out across every league mapped to `sport` and
   * filter team names client-side. Catches matches the search API misses
   * (e.g. lower-profile fixtures within the 14-day window).
   */
  private async searchViaScoreboard(
    query: string,
    sport: SupportedSport,
    leagueFilter: string | undefined,
  ): Promise<ExternalEventSummary[]> {
    const entries = pathsForSport(sport, leagueFilter);
    if (entries.length === 0) return [];

    const dateRange = formatDateRange(SCOREBOARD_LOOKAHEAD_DAYS);
    const queryLower = query.toLowerCase();

    const tasks = entries.map(({ leagueKey, path }) =>
      scanLeagueScoreboard({
        sport,
        leagueKey,
        path,
        dateRange,
        query: queryLower,
      }),
    );

    const settled = await Promise.allSettled(tasks);
    const all: ExternalEventSummary[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        all.push(...result.value);
      }
    }

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
