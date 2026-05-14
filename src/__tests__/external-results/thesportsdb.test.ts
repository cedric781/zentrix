import { describe, it, expect } from "vitest";
import { parseSportsDbResponse } from "@/lib/external-results/providers/thesportsdb";

describe("parseSportsDbResponse", () => {
  it("returns completed for finished match", () => {
    const result = parseSportsDbResponse({
      events: [
        {
          idEvent: "1",
          strStatus: "Match Finished",
          strHomeTeam: "Liverpool",
          strAwayTeam: "Chelsea",
          intHomeScore: "2",
          intAwayScore: "1",
          strTimestamp: "2026-05-14T20:00:00",
        },
      ],
    });
    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.homeScore).toBe(2);
      expect(result.awayScore).toBe(1);
      expect(result.homeTeam).toBe("Liverpool");
      expect(result.awayTeam).toBe("Chelsea");
    }
  });

  it("returns postponed when strPostponed yes", () => {
    const result = parseSportsDbResponse({
      events: [
        {
          idEvent: "1",
          strPostponed: "yes",
          strHomeTeam: "A",
          strAwayTeam: "B",
          intHomeScore: null,
          intAwayScore: null,
        },
      ],
    });
    expect(result.kind).toBe("postponed");
  });

  it("returns not_found when events null", () => {
    const result = parseSportsDbResponse({ events: null });
    expect(result.kind).toBe("not_found");
  });

  it("returns scheduled for unstarted match", () => {
    const result = parseSportsDbResponse({
      events: [
        {
          idEvent: "1",
          strStatus: "Not Started",
          strHomeTeam: "A",
          strAwayTeam: "B",
          intHomeScore: null,
          intAwayScore: null,
        },
      ],
    });
    expect(result.kind).toBe("scheduled");
  });
});
