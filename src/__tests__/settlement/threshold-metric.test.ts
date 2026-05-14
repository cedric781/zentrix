import { describe, it, expect } from "vitest";
import { ThresholdMetricService } from "@/lib/settlement/methods/threshold-metric";
import { SettlementError } from "@/lib/settlement/types";

describe("ThresholdMetricService", () => {
  const service = new ThresholdMetricService();

  const input = {
    betId: "bet-1",
    template: { slug: "test", settlementMethod: "THRESHOLD_METRIC" as const, allowedSources: [] },
    proof: {},
    initiatorUserId: "user-1",
  };

  it("validate throws NOT_IMPLEMENTED", () => {
    expect(() => service.validate(input)).toThrow(SettlementError);
  });

  it("resolve throws NOT_IMPLEMENTED", async () => {
    await expect(service.resolve(input)).rejects.toThrow(SettlementError);
  });

  it("error code is SETTLEMENT_NOT_IMPLEMENTED", () => {
    try {
      service.validate(input);
    } catch (e) {
      expect((e as SettlementError).code).toBe("SETTLEMENT_NOT_IMPLEMENTED");
    }
  });

  it("error statusCode is 501", () => {
    try {
      service.validate(input);
    } catch (e) {
      expect((e as SettlementError).statusCode).toBe(501);
    }
  });

  it("method property is THRESHOLD_METRIC", () => {
    expect(service.method).toBe("THRESHOLD_METRIC");
  });
});
