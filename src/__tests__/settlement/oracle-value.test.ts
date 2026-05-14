import { describe, it, expect } from "vitest";
import { OracleValueService } from "@/lib/settlement/methods/oracle-value";
import { SettlementError } from "@/lib/settlement/types";

describe("OracleValueService", () => {
  const service = new OracleValueService();

  const input = {
    betId: "bet-1",
    template: { slug: "test", settlementMethod: "ORACLE_VALUE" as const, allowedSources: [] },
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

  it("method property is ORACLE_VALUE", () => {
    expect(service.method).toBe("ORACLE_VALUE");
  });
});
