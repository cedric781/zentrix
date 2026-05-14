import type {
  ExternalResultProvider,
  FetchEventInput,
  ExternalEventResult,
} from "../types";
import { providerFetch, ProviderError } from "../types";

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
