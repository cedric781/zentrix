import { describe, it, expect } from "vitest";
import { parseEspnResponse } from "@/lib/external-results/providers/espn";

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
