# PROMPT_P20 — BetTemplate model + migration + types

**Status:** Spec — execution prompt.

## Context

P19 backend LIVE (commit dc1b671). Bet model heeft title/outcomeA/outcomeB.

P20 = eerste stap van Wager P2P template architecture roadmap (P20-P25):
- P20 — BetTemplate model + migration + types + Zod validators (deze)
- P21 — 107 templates seed data
- P22 — SettlementMethod enum + service
- P23 — Resolution API endpoints
- P24 — Frontend wizard architecture
- P25 — Frontend wizard execution

## Scope

### In scope
- Prisma model BetTemplate
- Prisma migration met --create-only
- Enum SettlementType (BINARY, THRESHOLD)
- src/lib/templates/types.ts (TypeScript types)
- src/lib/templates/schemas.ts (Zod validators)
- src/__tests__/templates/template-schema.test.ts (5 unit tests, Zod-only no DB)

### Out of scope
- 107 templates seed (P21)
- API endpoints (P23)
- createBet integration met templateSlug (P22)
- Frontend (P24-P25)
- FK constraints op createdById (later indien nodig)

## Schema design

```prisma
enum SettlementType {
  BINARY      // A wins or B wins
  THRESHOLD   // Above or below value
}

model BetTemplate {
  id                     String          @id @default(uuid())
  slug                   String          @unique
  name                   String
  category               String
  description            String?
  settlementType         SettlementType  @map("settlement_type")
  outcomeType            String          @map("outcome_type")
  fieldsSchema           Json            @map("fields_schema")
  allowedSources         Json            @map("allowed_sources")
  resolutionRule         String          @map("resolution_rule")
  supportsAutoResolve    Boolean         @default(false) @map("supports_auto_resolve")
  requiresOfficialEvent  Boolean         @default(false) @map("requires_official_event")
  
  // Zentrix improvements over Wager v2
  isActive               Boolean         @default(true) @map("is_active")
  version                Int             @default(1)
  createdById            String?         @map("created_by_id")
  createdAt              DateTime        @default(now()) @map("created_at")
  updatedAt              DateTime        @updatedAt @map("updated_at")
  deletedAt              DateTime?       @map("deleted_at")
  
  @@index([slug], map: "idx_bet_templates_slug")
  @@index([category, isActive, deletedAt], map: "idx_bet_templates_category_active")
  @@index([settlementType], map: "idx_bet_templates_settlement_type")
  @@index([deletedAt, isActive], map: "idx_bet_templates_soft_delete")
  @@map("bet_templates")
}
```

## Zentrix improvements vs Wager v2

- Soft delete via deletedAt (Wager had hard delete)
- version field voor optimistic locking
- isActive flag voor enable/disable zonder delete
- Audit trail: createdById, createdAt, updatedAt
- Strict camelCase in JSON columns

## src/lib/templates/types.ts

```typescript
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
```

## src/lib/templates/schemas.ts

```typescript
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
```

## src/__tests__/templates/template-schema.test.ts

```typescript
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
```

## Pre-flight

```bash
cd /workspaces/zentrix
git checkout main
git pull origin main
git status --short  # clean
git log --oneline -3  # 4d506a1 chore(repo): gitignore
git checkout -b wip-p20-bet-templates-schema
ls -la .env  # symlink → .env.local
pnpm prisma migrate status  # "up to date" geen drift
```

## Implementation steps

### Step 1 — Schema add
- Edit prisma/schema.prisma
- Add enum SettlementType near other enums
- Add model BetTemplate at end of file
- pnpm prisma format
- SHOW git diff prisma/schema.prisma
- PAUSE

### Step 2 — Migration (--create-only MANDATORY)
- pnpm prisma migrate dev --create-only --name add_bet_templates
- LATEST=$(ls prisma/migrations/ | grep add_bet_templates | head -1)
- cat prisma/migrations/$LATEST/migration.sql
- VERIFY: only CREATE TYPE + CREATE TABLE + 4 indexes
- ANY ALTER on existing tables → STOP
- PAUSE

### Step 2.5 — Prisma generate
- pnpm prisma generate
- Verify @prisma/client has BetTemplate type

### Step 3 — Create src/lib/templates/types.ts
- mkdir -p src/lib/templates
- Write file from spec above
- PAUSE

### Step 4 — Create src/lib/templates/schemas.ts
- Write file from spec above
- PAUSE

### Step 5 — Create test file
- mkdir -p src/__tests__/templates
- Write src/__tests__/templates/template-schema.test.ts from spec
- DO NOT run pnpm test
- PAUSE

### Step 6 — TypeScript verify
- pnpm tsc --noEmit 2>&1 | tail -10
- MUST be 0 errors
- PAUSE

### Step 7 — Commit + push
- git status --short (verify staged files)
- git add prisma/ src/lib/templates/ src/__tests__/templates/
- git commit (use message from below)
- git push origin wip-p20-bet-templates-schema
- PAUSE

### Step 8 — Open PR
- gh pr create with title + body (below)
- DO NOT merge
- Report PR URL

## Commit message

feat(p20): BetTemplate model + SettlementType enum

Foundation for Wager P2P template architecture (P20-P25 roadmap).

Schema:
- BetTemplate model with 17 columns
- SettlementType enum (BINARY, THRESHOLD)
- Zentrix improvements over Wager v2: soft delete, version,
  isActive, full audit trail
- 4 indexes for query performance

Types + validation:
- src/lib/templates/types.ts
- src/lib/templates/schemas.ts
- 5 Zod constraint tests

Out of scope: 107 templates seed (P21), API endpoints (P23),
createBet integration (P22), Frontend (P24-P25).

Migration applies via Vercel build (prisma migrate deploy).

## PR title

P20: BetTemplate model + SettlementType enum

## PR body

Foundation for Wager P2P template architecture (P20-P25 roadmap).

## Schema additions
- Enum SettlementType (BINARY, THRESHOLD)
- Model BetTemplate with 17 columns
- 4 indexes for query performance

## Zentrix improvements over Wager v2
- Soft delete via deletedAt
- Version field for optimistic locking
- isActive flag for enable/disable
- Full audit trail

## Validation
- 5 Zod constraint tests in src/__tests__/templates/

## Migration safety
- Pure new table
- Vercel build applies via prisma migrate deploy
- Tests not run locally (production DB)

## Roadmap
- P20 (this PR) Schema foundation
- P21 107 templates seed
- P22 SettlementMethod enum + service
- P23 API endpoints
- P24-P25 Frontend wizard

## Stop conditions

- Migration SQL touches existing tables (only CREATE TYPE + CREATE TABLE allowed)
- TypeScript errors in non-templates files
- Schema drift error (shouldn't but watch)
- Step 2 attempted without --create-only flag
- pnpm test attempted
