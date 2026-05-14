import { describe, it, expect } from "vitest";
import { PlatformProofService } from "@/lib/settlement/methods/platform-proof";
import { SettlementError } from "@/lib/settlement/types";

describe("PlatformProofService", () => {
  const service = new PlatformProofService();

  const validInput = {
    betId: "bet-1",
    template: { slug: "test", settlementMethod: "PLATFORM_PROOF" as const, allowedSources: [] },
    proof: { winnerSide: "A" },
    initiatorUserId: "user-1",
  };

  it("validates valid winnerSide A/B/VOID", () => {
    expect(() => service.validate(validInput)).not.toThrow();
    expect(() => service.validate({ ...validInput, proof: { winnerSide: "B" } })).not.toThrow();
    expect(() => service.validate({ ...validInput, proof: { winnerSide: "VOID" } })).not.toThrow();
  });

  it("rejects missing proof", () => {
    expect(() => service.validate({ ...validInput, proof: null })).toThrow(SettlementError);
  });

  it("rejects invalid winnerSide value", () => {
    expect(() => service.validate({ ...validInput, proof: { winnerSide: "INVALID" } })).toThrow(SettlementError);
  });

  it("resolve returns correct shape", async () => {
    const result = await service.resolve(validInput);
    expect(result.winnerSide).toBe("A");
    expect(result.method).toBe("PLATFORM_PROOF");
    expect(result.resolvedAt).toBeInstanceOf(Date);
  });

  it("evidence captures initiatorUserId", async () => {
    const result = await service.resolve(validInput);
    const evidence = result.evidence as { initiatorUserId: string };
    expect(evidence.initiatorUserId).toBe("user-1");
  });
});
