import type {
  ExternalResultProvider,
  FetchEventInput,
  ExternalEventResult,
} from "../types";
import { providerFetch, ProviderError } from "../types";

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
