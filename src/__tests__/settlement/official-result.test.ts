import { describe, it, expect } from "vitest";
import { OfficialResultService } from "@/lib/settlement/methods/official-result";
import { SettlementError } from "@/lib/settlement/types";

describe("OfficialResultService", () => {
  const service = new OfficialResultService();

  const validInput = {
    betId: "bet-1",
    template: {
      slug: "football-match-winner",
      settlementMethod: "OFFICIAL_RESULT" as const,
      allowedSources: [{ providerId: "fifa", name: "FIFA", type: "OFFICIAL_API" }],
    },
    proof: {
      sourceUrl: "https://fifa.com/match/123",
      resultData: { winnerSide: "A" },
    },
    initiatorUserId: "user-1",
  };

  it("validates valid input with allowed source", () => {
    expect(() => service.validate(validInput)).not.toThrow();
  });

  it("rejects missing sourceUrl", () => {
    expect(() => service.validate({ ...validInput, proof: { resultData: { winnerSide: "A" } } })).toThrow(SettlementError);
  });

  it("rejects unallowed source", () => {
    const badProof = { sourceUrl: "https://random-site.com/match/123", resultData: { winnerSide: "A" } };
    expect(() => service.validate({ ...validInput, proof: badProof })).toThrow(SettlementError);
  });

  it("resolve returns correct shape", async () => {
    const result = await service.resolve(validInput);
    expect(result.winnerSide).toBe("A");
    expect(result.method).toBe("OFFICIAL_RESULT");
  });

  it("evidence captures sourceUrl", async () => {
    const result = await service.resolve(validInput);
    const evidence = result.evidence as { sourceUrl: string };
    expect(evidence.sourceUrl).toBe("https://fifa.com/match/123");
  });
});
