import { describe, it, expect } from "vitest";
import {
  SettlementTypeSchema,
  CreateBetTemplateInputSchema,
} from "@/lib/templates/schemas";

describe("BetTemplate schemas", () => {
  const validInput = {
    slug: "match-winner",
    name: "Match Winner",
    category: "Sport",
    description: "Bet on the winner of a match",
    settlementType: "BINARY" as const,
    outcomeType: "WINNER",
    fieldsSchema: {
      type: "object" as const,
      properties: {
        homeTeam: { type: "string" },
        awayTeam: { type: "string" },
      },
      required: ["homeTeam", "awayTeam"],
      additionalProperties: false,
    },
    allowedSources: [
      { providerId: "espn", name: "ESPN", type: "OFFICIAL_API" as const },
    ],
    resolutionRule: "Settled based on official match result from ESPN.",
    supportsAutoResolve: false,
    requiresOfficialEvent: true,
  };

  it("accepts valid CreateBetTemplateInput", () => {
    const result = CreateBetTemplateInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug (uppercase)", () => {
    const result = CreateBetTemplateInputSchema.safeParse({
      ...validInput,
      slug: "Match-Winner",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty allowedSources", () => {
    const result = CreateBetTemplateInputSchema.safeParse({
      ...validInput,
      allowedSources: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid SettlementType", () => {
    const result = SettlementTypeSchema.safeParse("INVALID");
    expect(result.success).toBe(false);
  });

  it("rejects fieldsSchema with non-object type", () => {
    const result = CreateBetTemplateInputSchema.safeParse({
      ...validInput,
      fieldsSchema: { type: "array", properties: {} } as any,
    });
    expect(result.success).toBe(false);
  });
});
