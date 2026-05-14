import type { BetTemplate as PrismaBetTemplate } from "@prisma/client";

export type BetTemplate = PrismaBetTemplate;
export type SettlementType = "BINARY" | "THRESHOLD";
export type OutcomeType = "WINNER" | "ABOVE_BELOW" | "YES_NO";

export type AllowedSource = {
  providerId: string;
  name: string;
  type: "OFFICIAL_API" | "ORACLE_PROVIDER" | "LEAGUE_STAT_SOURCE" | "PLATFORM_VERIFIED";
};

export type FieldsSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};
