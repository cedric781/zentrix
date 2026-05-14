import { z } from "zod";

export const SettlementTypeSchema = z.enum(["BINARY", "THRESHOLD"]);

export const OutcomeTypeSchema = z.enum(["WINNER", "ABOVE_BELOW", "YES_NO"]);

export const FieldsSchemaJsonSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.any()),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

export const AllowedSourceSchema = z.object({
  providerId: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  type: z.enum(["OFFICIAL_API", "ORACLE_PROVIDER", "LEAGUE_STAT_SOURCE", "PLATFORM_VERIFIED"]),
});

export const AllowedSourcesSchema = z.array(AllowedSourceSchema).min(1).max(10);

export const CreateBetTemplateInputSchema = z.object({
  slug: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(50),
  description: z.string().max(2000).optional(),
  settlementType: SettlementTypeSchema,
  outcomeType: z.string().min(1).max(50),
  fieldsSchema: FieldsSchemaJsonSchema,
  allowedSources: AllowedSourcesSchema,
  resolutionRule: z.string().min(10).max(1000),
  supportsAutoResolve: z.boolean().default(false),
  requiresOfficialEvent: z.boolean().default(false),
});
