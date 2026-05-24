import { describe, it, expect } from "vitest";
import { parseEspnResponse } from "@/lib/external-results/providers/espn";
import { DURATION_BY_SPORT_MS } from "@/lib/external-results/types";
import type { SupportedSport } from "@/lib/api/types";

describe("parseEspnResponse", () => {
  it("returns completed for finished match with scores", () => {
    const result = parseEspnResponse({
      competitions: [
        {
          status: { type: { state: "post", completed: true } },
          date: "2026-05-14T20:00Z",
          competitors: [
            {
              homeAway: "home",
              score: "102",
              team: { displayName: "Lakers" },
            },
            {
              homeAway: "away",
              score: "98",
              team: { displayName: "Celtics" },
            },
          ],
        },
      ],
    });
    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.homeTeam).toBe("Lakers");
      expect(result.awayTeam).toBe("Celtics");
      expect(result.homeScore).toBe(102);
      expect(result.awayScore).toBe(98);
    }
  });

  it("returns draw for equal scores", () => {
    const result = parseEspnResponse({
      competitions: [
        {
          status: { type: { state: "post", completed: true } },
          date: "2026-05-14T20:00Z",
          competitors: [
            { homeAway: "home", score: "1", team: { displayName: "Ajax" } },
            { homeAway: "away", score: "1", team: { displayName: "PSV" } },
          ],
        },
      ],
    });
    expect(result.kind).toBe("draw");
  });

  it("returns scheduled for pre-match state", () => {
    const result = parseEspnResponse({
      competitions: [{ status: { type: { state: "pre" } }, competitors: [] }],
    });
    expect(result.kind).toBe("scheduled");
  });

  it("returns in_progress for live match", () => {
    const result = parseEspnResponse({
      competitions: [{ status: { type: { state: "in" } }, competitors: [] }],
    });
    expect(result.kind).toBe("in_progress");
  });

  it("returns not_found when competitions array empty", () => {
    const result = parseEspnResponse({});
    expect(result.kind).toBe("not_found");
  });

  it("returns postponed when description contains 'postpone'", () => {
    const result = parseEspnResponse({
      competitions: [
        {
          status: {
            type: {
              state: "post",
              completed: false,
              description: "Postponed due to weather",
            },
          },
          competitors: [],
        },
      ],
    });
    expect(result.kind).toBe("postponed");
  });

  it("throws ProviderError on missing team names in completed match", () => {
    expect(() =>
      parseEspnResponse({
        competitions: [
          {
            status: { type: { state: "post", completed: true } },
            competitors: [
              { homeAway: "home", score: "1" },
              { homeAway: "away", score: "0", team: { displayName: "X" } },
            ],
          },
        ],
      }),
    ).toThrow(/team names/);
  });
});

describe("DURATION_BY_SPORT_MS — per-sport coverage", () => {
  it("covers all 7 SupportedSport values", () => {
    const allSports: SupportedSport[] = [
      "football", "basketball", "american_football", "ice_hockey",
      "baseball", "tennis", "mma",
    ];
    for (const sport of allSports) {
      expect(DURATION_BY_SPORT_MS[sport]).toBeGreaterThan(0);
    }
  });

  it("football duration is between 2h and 3h (sanity)", () => {
    const ms = DURATION_BY_SPORT_MS.football;
    expect(ms).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(3 * 60 * 60 * 1000);
  });

  it("tennis duration is longer than football (best-of-5)", () => {
    expect(DURATION_BY_SPORT_MS.tennis).toBeGreaterThan(DURATION_BY_SPORT_MS.football);
  });

  it("mma is shortest (2h)", () => {
    const mma = DURATION_BY_SPORT_MS.mma;
    const others: SupportedSport[] = ["football", "basketball", "american_football", "ice_hockey", "baseball", "tennis"];
    for (const sport of others) {
      expect(DURATION_BY_SPORT_MS[sport]).toBeGreaterThanOrEqual(mma);
    }
  });
});
