import type {
  ExternalResultProvider,
  FetchEventInput,
  ExternalEventResult,
  SearchEventsParams,
  ExternalEventSummary,
} from "../types";
import { providerFetch, ProviderError } from "../types";
import type { SupportedSport } from "@/lib/api/types";

const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_RESULT_LIMIT = 10;
const TEAMS_TO_PROBE = 5;
const TSDB_USER_AGENT = "Zentrix/1.0";

// TheSportsDB exposes a `strSport` string per team/event. Map our enum
// to their label so we can filter cross-sport matches (e.g. "Manchester
// United" returns rugby + soccer teams; we only want soccer).
const TSDB_SPORT_LABELS: Record<SupportedSport, string> = {
  football: "Soccer",
  basketball: "Basketball",
  american_football: "American Football",
  ice_hockey: "Ice Hockey",
  baseball: "Baseball",
  tennis: "Tennis",
  mma: "Fighting",
};

type TsdbSearchTeamsResponse = {
  teams?: Array<{
    idTeam: string;
    strTeam?: string;
    strSport?: string;
    strLeague?: string;
  }> | null;
};

type TsdbEventsNextResponse = {
  events?: Array<{
    idEvent: string;
    strEvent?: string;
    strHomeTeam?: string;
    strAwayTeam?: string;
    strLeague?: string;
    strSport?: string;
    dateEvent?: string;
    strTime?: string;
    strTimestamp?: string;
  }> | null;
};

export type SportsDbResponse = {
  events?: Array<{
    idEvent: string;
    strStatus?: string;
    strHomeTeam?: string;
    strAwayTeam?: string;
    intHomeScore?: string | null;
    intAwayScore?: string | null;
    dateEventLocal?: string;
    strTimestamp?: string;
    strPostponed?: string;
  }> | null;
};

export class TheSportsDbProvider implements ExternalResultProvider {
  readonly name = "thesportsdb" as const;

  async fetchEvent(input: FetchEventInput): Promise<ExternalEventResult> {
    // TheSportsDB heeft globale event-ID, sport/league niet nodig in URL
    const apiKey = process.env.THESPORTSDB_API_KEY ?? "3"; // free tier default
    const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupevent.php?id=${encodeURIComponent(input.eventId)}`;

    const raw = await providerFetch("thesportsdb", url);
    if (raw === null) return { kind: "not_found" };

    return parseSportsDbResponse(raw as SportsDbResponse);
  }

  /**
   * P40 autocomplete via team lookup + upcoming events:
   *   1. /searchteams.php?t=<query> returns teams whose name contains query
   *   2. Filter to teams in the requested sport (strSport match)
   *   3. For up to TEAMS_TO_PROBE matching teams, fetch /eventsnext.php
   *   4. Flatten + dedupe by idEvent, optional league filter, cap at 10
   *
   * Errors at each step are logged to console.warn and treated as empty —
   * a partial result beats no result.
   */
  async searchEvents(
    params: SearchEventsParams,
  ): Promise<ExternalEventSummary[]> {
    const query = params.query.trim();
    if (query.length < 2) return [];

    const apiKey = process.env.THESPORTSDB_API_KEY ?? "3";
    const sportLabel = TSDB_SPORT_LABELS[params.sport];

    const teamsUrl = `https://www.thesportsdb.com/api/v1/json/${apiKey}/searchteams.php?t=${encodeURIComponent(query)}`;
    let teamsRaw: unknown;
    try {
      teamsRaw = await providerFetch("thesportsdb", teamsUrl, {
        headers: { "User-Agent": TSDB_USER_AGENT },
        timeoutMs: SEARCH_TIMEOUT_MS,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.warn(`thesportsdb searchEvents: searchteams failed: ${msg}`);
      return [];
    }
    if (teamsRaw === null) return [];
    const teams = (teamsRaw as TsdbSearchTeamsResponse).teams ?? [];

    const candidates = teams
      .filter((t) => t.strSport === sportLabel)
      .slice(0, TEAMS_TO_PROBE);
    if (candidates.length === 0) return [];

    const eventLists = await Promise.allSettled(
      candidates.map(async (team) => {
        const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsnext.php?id=${encodeURIComponent(team.idTeam)}`;
        try {
          const raw = await providerFetch("thesportsdb", url, {
            headers: { "User-Agent": TSDB_USER_AGENT },
            timeoutMs: SEARCH_TIMEOUT_MS,
          });
          if (raw === null) return [] as ExternalEventSummary[];
          return mapTsdbEvents(raw as TsdbEventsNextResponse, params);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown";
          console.warn(
            `thesportsdb searchEvents: eventsnext team=${team.idTeam} failed: ${msg}`,
          );
          return [] as ExternalEventSummary[];
        }
      }),
    );

    const all: ExternalEventSummary[] = [];
    for (const r of eventLists) {
      if (r.status === "fulfilled") all.push(...r.value);
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

function mapTsdbEvents(
  data: TsdbEventsNextResponse,
  params: SearchEventsParams,
): ExternalEventSummary[] {
  const events = data.events ?? [];
  const sportLabel = TSDB_SPORT_LABELS[params.sport];
  const out: ExternalEventSummary[] = [];

  for (const event of events) {
    if (event.strSport !== sportLabel) continue;
    if (params.league && event.strLeague !== params.league) continue;

    const homeTeam = event.strHomeTeam;
    const awayTeam = event.strAwayTeam;
    if (!homeTeam || !awayTeam) continue;

    const startIsoRaw =
      event.strTimestamp ??
      (event.dateEvent
        ? `${event.dateEvent}T${event.strTime ?? "00:00:00"}Z`
        : null);
    if (!startIsoRaw) continue;
    const startDate = new Date(startIsoRaw);
    if (Number.isNaN(startDate.getTime())) continue;

    const leagueLabel = event.strLeague ?? "";
    const datePart = startDate.toISOString().slice(0, 10);
    out.push({
      provider: "thesportsdb",
      providerEventId: event.idEvent,
      sport: params.sport,
      league: leagueLabel,
      homeTeam,
      awayTeam,
      startsAt: startDate.toISOString(),
      label: `${homeTeam} vs ${awayTeam} — ${leagueLabel} — ${datePart}`,
    });
  }
  return out;
}

export function parseSportsDbResponse(
  data: SportsDbResponse,
): ExternalEventResult {
  const event = data.events?.[0];
  if (!event) return { kind: "not_found" };

  if (event.strPostponed === "yes") {
    return { kind: "postponed" };
  }

  const status = event.strStatus?.toLowerCase() ?? "";
  if (status.includes("cancel")) return { kind: "cancelled" };
  if (status.includes("postpone")) return { kind: "postponed" };

  // Finished signals: "Match Finished" / "FT" / "Final" / "AET" / "AP"
  const isFinished = ["match finished", "ft", "final", "aet", "ap"].some((s) =>
    status.includes(s),
  );

  if (!isFinished) {
    if (
      status.includes("progress") ||
      status.includes("ht") ||
      status.includes("live")
    ) {
      return { kind: "in_progress" };
    }
    return { kind: "scheduled" };
  }

  const homeTeam = event.strHomeTeam;
  const awayTeam = event.strAwayTeam;
  if (!homeTeam || !awayTeam) {
    throw new ProviderError(
      "thesportsdb",
      "PARSE_ERROR",
      "Missing team names",
    );
  }

  const homeScore = parseInt(event.intHomeScore ?? "", 10);
  const awayScore = parseInt(event.intAwayScore ?? "", 10);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
    throw new ProviderError(
      "thesportsdb",
      "PARSE_ERROR",
      "Non-numeric score",
    );
  }

  const finishedAt = event.strTimestamp
    ? new Date(event.strTimestamp)
    : event.dateEventLocal
      ? new Date(event.dateEventLocal)
      : new Date();

  if (homeScore === awayScore) {
    return {
      kind: "draw",
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      finishedAt,
    };
  }
  return {
    kind: "completed",
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    finishedAt,
  };
}
