import { describe, it, expect } from "vitest";
import { mapWinner } from "@/lib/external-results/winner-mapping";
import { normalizeTeamName } from "@/lib/external-results/team-aliases";

const baseBet = {
  outcomeA: "Lakers wins",
  outcomeB: "Celtics wins",
  creatorSide: "A",
  createdById: "user-creator",
  opponentUserId: "user-opponent" as string | null,
};

const finished = (homeTeam: string, awayTeam: string, h: number, a: number) =>
  ({
    kind: "completed" as const,
    homeTeam,
    awayTeam,
    homeScore: h,
    awayScore: a,
    finishedAt: new Date(),
  });

describe("normalizeTeamName", () => {
  it("matches canonical directly", () => {
    expect(normalizeTeamName("lakers", "basketball")).toBe("lakers");
  });
  it("matches alias case-insensitive", () => {
    expect(normalizeTeamName("Los Angeles Lakers", "basketball")).toBe("lakers");
    expect(normalizeTeamName("LA Lakers", "basketball")).toBe("lakers");
  });
  it("returns null for unknown", () => {
    expect(normalizeTeamName("zentrix all-stars", "basketball")).toBeNull();
  });
  it("matches via tight substring (within conservative window)", () => {
    expect(normalizeTeamName("go lakers", "basketball")).toBe("lakers");
  });
  it("does NOT match loose substring (outside conservative window)", () => {
    expect(normalizeTeamName("the lakers franchise", "basketball")).toBeNull();
  });
  it("does not match too-short substring", () => {
    expect(normalizeTeamName("city", "football")).toBeNull();
  });
});

describe("mapWinner", () => {
  it("resolves when home team wins and matches outcome", () => {
    const r = mapWinner(finished("Lakers", "Celtics", 102, 98), baseBet, "basketball");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") {
      expect(r.winnerSide).toBe("A");
      expect(r.winnerUserId).toBe("user-creator");
      expect(r.matchedTeam).toBe("lakers");
    }
  });

  it("resolves when away team wins", () => {
    const r = mapWinner(finished("Lakers", "Celtics", 98, 102), baseBet, "basketball");
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") {
      expect(r.winnerSide).toBe("B");
      expect(r.winnerUserId).toBe("user-opponent");
    }
  });

  it("returns draw for tie", () => {
    const r = mapWinner(
      {
        kind: "draw",
        homeTeam: "Lakers",
        awayTeam: "Celtics",
        homeScore: 100,
        awayScore: 100,
        finishedAt: new Date(),
      },
      baseBet,
      "basketball",
    );
    expect(r.kind).toBe("draw");
  });

  it("returns not_ready for in_progress", () => {
    const r = mapWinner({ kind: "in_progress" }, baseBet, "basketball");
    expect(r.kind).toBe("not_ready");
  });

  it("returns failed for postponed", () => {
    const r = mapWinner({ kind: "postponed" }, baseBet, "basketball");
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("postponed");
  });

  it("returns ambiguous when winner not in alias map", () => {
    const r = mapWinner(
      finished("Unknown Team X", "Lakers", 5, 4),
      baseBet,
      "basketball",
    );
    expect(r.kind).toBe("ambiguous");
  });

  it("returns ambiguous when both outcomes match same winner", () => {
    const r = mapWinner(
      finished("Lakers", "Celtics", 102, 98),
      { ...baseBet, outcomeA: "Lakers wins", outcomeB: "Lakers wins by 10+" },
      "basketball",
    );
    expect(r.kind).toBe("ambiguous");
  });

  it("returns ambiguous when neither outcome matches winner", () => {
    const r = mapWinner(
      finished("Lakers", "Celtics", 102, 98),
      { ...baseBet, outcomeA: "Bulls win", outcomeB: "Heat win" },
      "basketball",
    );
    expect(r.kind).toBe("ambiguous");
  });

  it("handles alias correctly: Los Angeles Lakers wins, outcome says 'Lakers wins'", () => {
    const r = mapWinner(
      finished("Los Angeles Lakers", "Boston Celtics", 110, 98),
      baseBet,
      "basketball",
    );
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.winnerSide).toBe("A");
  });

  it("creatorSide B inverts winner mapping", () => {
    const r = mapWinner(
      finished("Lakers", "Celtics", 102, 98),
      { ...baseBet, creatorSide: "B" },
      "basketball",
    );
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") {
      expect(r.winnerSide).toBe("A");
      expect(r.winnerUserId).toBe("user-opponent");
    }
  });

  it("returns ambiguous for null opponentUserId", () => {
    const r = mapWinner(
      finished("Lakers", "Celtics", 102, 98),
      { ...baseBet, opponentUserId: null, creatorSide: "B" },
      "basketball",
    );
    expect(r.kind).toBe("ambiguous");
  });

  it("football: Manchester United wins via alias", () => {
    const r = mapWinner(
      finished("Manchester United", "Liverpool", 2, 1),
      {
        outcomeA: "Man Utd wins",
        outcomeB: "Liverpool wins",
        creatorSide: "A",
        createdById: "u1",
        opponentUserId: "u2",
      },
      "football",
    );
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.matchedTeam).toBe("manchester united");
  });
});

describe("normalizeTeamName — Premier League coverage", () => {
  // ESPN's officiële display names (verified 24 mei 2026)
  const PREMIER_LEAGUE_TEAMS_ESPN = [
    "Manchester United",
    "Manchester City",
    "Liverpool",
    "Chelsea",
    "Arsenal",
    "Tottenham Hotspur",
    "Newcastle United",
    "West Ham United",
    "Aston Villa",
    "Brighton & Hove Albion",
    "Crystal Palace",
    "Fulham",
    "Wolverhampton Wanderers",
    "Burnley",
    "Brentford",
    "Nottingham Forest",
    "AFC Bournemouth",
    "Sunderland",
    "Everton",
    "Leeds United",
  ];

  it.each(PREMIER_LEAGUE_TEAMS_ESPN)("normalizes ESPN name '%s' to a canonical", (espnName) => {
    const result = normalizeTeamName(espnName, "football");
    expect(result).not.toBeNull();
  });

  it("sunderland regression — bet 151dcaa6 root cause", () => {
    expect(normalizeTeamName("Sunderland", "football")).toBe("sunderland");
  });

  it("does not match basketball alias 'wolves' for football query", () => {
    // wolves is alias of timberwolves (basketball) AND wolverhampton (football)
    // Both sports independent — sport-scoping must work
    const footballResult = normalizeTeamName("wolves", "football");
    const basketballResult = normalizeTeamName("wolves", "basketball");
    expect(footballResult).toBe("wolverhampton");
    expect(basketballResult).toBe("timberwolves");
  });
});
