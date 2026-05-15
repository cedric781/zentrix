import type { Bet } from "@prisma/client";
import type { ExternalEventResult } from "./types";
import type { SupportedSport } from "@/lib/api/types";
import { normalizeTeamName } from "./team-aliases";

export type WinnerMappingResult =
  | { kind: "resolved"; winnerSide: "A" | "B"; winnerUserId: string; matchedTeam: string }
  | { kind: "draw"; reason: string }
  | { kind: "ambiguous"; reason: string }
  | { kind: "not_ready"; status: "in_progress" | "scheduled" }
  | { kind: "failed"; reason: "postponed" | "cancelled" | "not_found" };

export function mapWinner(
  result: ExternalEventResult,
  bet: Pick<Bet, "outcomeA" | "outcomeB" | "creatorSide" | "createdById" | "opponentUserId">,
  sport: SupportedSport,
): WinnerMappingResult {
  if (result.kind === "scheduled") return { kind: "not_ready", status: "scheduled" };
  if (result.kind === "in_progress") return { kind: "not_ready", status: "in_progress" };
  if (result.kind === "postponed") return { kind: "failed", reason: "postponed" };
  if (result.kind === "cancelled") return { kind: "failed", reason: "cancelled" };
  if (result.kind === "not_found") return { kind: "failed", reason: "not_found" };

  if (result.kind === "draw") {
    return {
      kind: "draw",
      reason: `${result.homeTeam} ${result.homeScore}-${result.awayScore} ${result.awayTeam}`,
    };
  }

  if (result.kind !== "completed") {
    return { kind: "ambiguous", reason: `Unexpected result kind: ${(result as { kind: string }).kind}` };
  }

  const winnerName = result.homeScore > result.awayScore ? result.homeTeam : result.awayTeam;
  const winnerNormalized = normalizeTeamName(winnerName, sport);

  if (!winnerNormalized) {
    return {
      kind: "ambiguous",
      reason: `Winner "${winnerName}" not recognized in ${sport} alias map`,
    };
  }

  const matchA = outcomeMatchesTeam(bet.outcomeA, winnerNormalized, sport);
  const matchB = outcomeMatchesTeam(bet.outcomeB, winnerNormalized, sport);

  if (matchA && matchB) {
    return {
      kind: "ambiguous",
      reason: `Both outcomes match "${winnerName}" — bet wording ambiguous (A: "${bet.outcomeA}", B: "${bet.outcomeB}")`,
    };
  }
  if (!matchA && !matchB) {
    return {
      kind: "ambiguous",
      reason: `Neither outcome matches "${winnerName}" (A: "${bet.outcomeA}", B: "${bet.outcomeB}")`,
    };
  }

  const winnerSide: "A" | "B" = matchA ? "A" : "B";
  const winnerUserId =
    winnerSide === bet.creatorSide ? bet.createdById : bet.opponentUserId;

  if (!winnerUserId) {
    return {
      kind: "ambiguous",
      reason: `Bet has null opponentUserId — cannot resolve winner side ${winnerSide}`,
    };
  }

  return {
    kind: "resolved",
    winnerSide,
    winnerUserId,
    matchedTeam: winnerNormalized,
  };
}

function outcomeMatchesTeam(outcome: string, teamCanonical: string, sport: SupportedSport): boolean {
  const outcomeLower = outcome.toLowerCase();

  if (outcomeLower.includes(teamCanonical)) return true;

  const normalizedFromOutcome = normalizeTeamName(outcome, sport);
  if (normalizedFromOutcome === teamCanonical) return true;

  const words = outcomeLower.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= words.length; j++) {
      const candidate = words.slice(i, j).join(" ");
      if (candidate.length < 4) continue;
      const normalized = normalizeTeamName(candidate, sport);
      if (normalized === teamCanonical) return true;
    }
  }

  return false;
}
