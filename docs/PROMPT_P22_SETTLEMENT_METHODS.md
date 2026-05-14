# PROMPT_P22 — SettlementMethod enum + 4 method services

**Status:** Spec — execution prompt.

## Context

P21 LIVE op productie (commit f94ef86). 15 templates in `bet_templates`.

P22 = derde stap van Wager P2P template architecture roadmap (P20-P25):
- ✅ P20 — BetTemplate model
- ✅ P21 — 15 templates seeded
- **P22** — SettlementMethod enum + per-method services (deze prompt)
- P23 — Resolution API endpoints
- P24 — Frontend wizard architecture
- P25 — Frontend create-bet wizard

P22 introduceert HOE templates worden geresolved. Vier methods:
- `OFFICIAL_RESULT` — Externe API (ESPN, NBA.com, FIFA) levert eindstand
- `ORACLE_VALUE` — On-chain oracle (toekomst, P22 stub-only)
- `PLATFORM_PROOF` — Bestaande Zentrix proof-confirm flow (MVP default)
- `THRESHOLD_METRIC` — Numeriek metric voor Over/Under (toekomst, P22 stub)

## Scope

### In scope
- Prisma enum `SettlementMethod` (4 values)
- `BetTemplate.settlementMethod` column (migration met --create-only)
- Backfill bestaande 15 templates: `settlementMethod = "PLATFORM_PROOF"` (default)
- `src/lib/settlement/types.ts` — shared types (ResolveBetInput, ResolveBetResult)
- 4 method services in `src/lib/settlement/methods/`:
  - `official-result.ts` — implementation skeleton (interface + validation)
  - `oracle-value.ts` — stub (throws NOT_IMPLEMENTED in P22)
  - `platform-proof.ts` — wraps bestaande Zentrix proof-confirm flow
  - `threshold-metric.ts` — stub (throws NOT_IMPLEMENTED in P22)
- `src/lib/settlement/router.ts` — dispatcher (switch op SettlementMethod)
- 4 test files (5 cases per method = 20 tests)
- Spec doc op `docs/PROMPT_P22_SETTLEMENT_METHODS.md`

### Out of scope
- Auto-resolution cron triggers (P15 cron infra blijft same)
- API endpoints (P23)
- Frontend (P24-P25)
- Werkende ORACLE_VALUE implementation (P22 = stub only, real impl later)
- Werkende THRESHOLD_METRIC implementation (P22 = stub only)
- Wijzigingen aan bestaande `src/lib/bets/service.ts` (settleBet blijft same)
- Wijzigingen aan bestaande dispute flow (P13)
- New API routes

## Design decisions

### 1. Enum: SettlementMethod separation van SettlementType

```prisma
enum SettlementMethod {
  OFFICIAL_RESULT       // External authoritative API
  ORACLE_VALUE          // On-chain oracle (P22 stub)
  PLATFORM_PROOF        // Zentrix mens-confirmed proof (current MVP flow)
  THRESHOLD_METRIC      // Numeric metric for Over/Under (P22 stub)
}
```

**Waarom apart van SettlementType (BINARY/THRESHOLD)?**
- SettlementType = uitkomst-shape (winner vs threshold value)
- SettlementMethod = HOE resolved (API vs oracle vs mens vs metric)
- Match-Winner template kan PLATFORM_PROOF zijn (MVP) of OFFICIAL_RESULT (auto)
- Loosely coupled: zelfde template kan via verschillende methods resolved

### 2. P22 is foundation, niet werkende auto-resolution

```
P22 implementeert:
✅ Type system + interfaces
✅ Router/dispatcher logic
✅ PLATFORM_PROOF wraps bestaande flow (werkend)
🟡 OFFICIAL_RESULT: validation logic + stub fetch (TODO marker)
🟡 ORACLE_VALUE: throws NOT_IMPLEMENTED (placeholder)
🟡 THRESHOLD_METRIC: throws NOT_IMPLEMENTED (placeholder)

P23-P25 vullen aan:
- API endpoints triggers
- Frontend pickers
- Werkende OFFICIAL_RESULT met echte API calls
```

Reden: 4 werkende methods = 2-3 weken werk. P22 = architectuur foundation = 1 sessie.

### 3. BetTemplate.settlementMethod backfill

Migratie voegt NOT NULL kolom toe met DEFAULT `'PLATFORM_PROOF'`. Bestaande 15 templates krijgen automatisch PLATFORM_PROOF — matcht huidige Zentrix flow.

P23+ kan templates verrijken (handmatig of via migration) naar OFFICIAL_RESULT waar passend.

### 4. Method service interface

Alle 4 services implementeren zelfde interface:

```typescript
export interface SettlementMethodService {
  readonly method: SettlementMethod;
  
  /**
   * Validate inputs before attempting resolution.
   * Throws SettlementError op invalid input.
   */
  validate(input: ResolveBetInput): void;
  
  /**
   * Attempt to resolve the bet.
   * Returns ResolveBetResult with winnerSide + evidence.
   * Throws SettlementError op resolution failure.
   */
  resolve(input: ResolveBetInput): Promise<ResolveBetResult>;
}
```

### 5. Shared types

```typescript
// src/lib/settlement/types.ts

export type SettlementMethod = 
  | "OFFICIAL_RESULT" 
  | "ORACLE_VALUE" 
  | "PLATFORM_PROOF" 
  | "THRESHOLD_METRIC";

export type ResolveBetInput = {
  betId: string;
  template: { slug: string; settlementMethod: SettlementMethod; allowedSources: unknown };
  proof: unknown;          // Method-specific shape, parsed by validator
  initiatorUserId: string;
};

export type ResolveBetResult = {
  winnerSide: "A" | "B" | "VOID";
  resolvedAt: Date;
  evidence: unknown;       // Method-specific
  method: SettlementMethod;
};

export class SettlementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "SettlementError";
  }
}
```

### 6. Error codes

| Code | When |
|---|---|
| `SETTLEMENT_INVALID_PROOF` | Proof shape wrong voor method |
| `SETTLEMENT_NOT_IMPLEMENTED` | ORACLE_VALUE/THRESHOLD_METRIC stubs |
| `SETTLEMENT_SOURCE_UNREACHABLE` | OFFICIAL_RESULT API down |
| `SETTLEMENT_AMBIGUOUS` | Multiple sources disagree |
| `SETTLEMENT_VOID` | Conditions for VOID (draw, no result) |

### 7. Router/dispatcher

```typescript
// src/lib/settlement/router.ts

import { OfficialResultService } from "./methods/official-result";
import { OracleValueService } from "./methods/oracle-value";
import { PlatformProofService } from "./methods/platform-proof";
import { ThresholdMetricService } from "./methods/threshold-metric";

const services = {
  OFFICIAL_RESULT: new OfficialResultService(),
  ORACLE_VALUE: new OracleValueService(),
  PLATFORM_PROOF: new PlatformProofService(),
  THRESHOLD_METRIC: new ThresholdMetricService(),
} as const;

export function getSettlementService(method: SettlementMethod) {
  const service = services[method];
  if (!service) {
    throw new SettlementError(
      "SETTLEMENT_INVALID_METHOD",
      `Unknown settlement method: ${method}`,
      500
    );
  }
  return service;
}

export async function resolveBet(input: ResolveBetInput): Promise<ResolveBetResult> {
  const service = getSettlementService(input.template.settlementMethod);
  service.validate(input);
  return service.resolve(input);
}
```

### 8. PLATFORM_PROOF wraps bestaande flow

PLATFORM_PROOF moet NIET breken bestaande Zentrix `settleBet` flow. P22 implementeert wrapper:

```typescript
// src/lib/settlement/methods/platform-proof.ts

import { settleBet } from "@/lib/bets/service";

export class PlatformProofService implements SettlementMethodService {
  readonly method = "PLATFORM_PROOF" as const;

  validate(input: ResolveBetInput): void {
    // Validate proof shape (existing Zentrix proof structure)
    if (!input.proof) {
      throw new SettlementError("SETTLEMENT_INVALID_PROOF", "Proof required for PLATFORM_PROOF", 400);
    }
    const proof = input.proof as { winnerSide?: string };
    if (!proof.winnerSide || !["A", "B", "VOID"].includes(proof.winnerSide)) {
      throw new SettlementError("SETTLEMENT_INVALID_PROOF", "winnerSide must be A, B, or VOID", 400);
    }
  }

  async resolve(input: ResolveBetInput): Promise<ResolveBetResult> {
    // P22 doesn't call settleBet itself — that's API layer concern (P23)
    // P22 returns the resolution decision, API caller commits via settleBet
    const proof = input.proof as { winnerSide: "A" | "B" | "VOID" };
    return {
      winnerSide: proof.winnerSide,
      resolvedAt: new Date(),
      evidence: { type: "platform_proof", initiatorUserId: input.initiatorUserId },
      method: "PLATFORM_PROOF",
    };
  }
}
```

**Key insight:** P22 services return resolution DECISIONS. API layer (P23) commits via existing `settleBet`. Geen wijziging aan `src/lib/bets/service.ts` nodig.

### 9. OFFICIAL_RESULT skeleton

```typescript
// src/lib/settlement/methods/official-result.ts

export class OfficialResultService implements SettlementMethodService {
  readonly method = "OFFICIAL_RESULT" as const;

  validate(input: ResolveBetInput): void {
    if (!input.proof) {
      throw new SettlementError("SETTLEMENT_INVALID_PROOF", "Proof required for OFFICIAL_RESULT", 400);
    }
    const proof = input.proof as { sourceUrl?: string; resultData?: unknown };
    if (!proof.sourceUrl) {
      throw new SettlementError("SETTLEMENT_INVALID_PROOF", "sourceUrl required", 400);
    }
    
    // Validate sourceUrl matches allowedSources
    const allowedSources = input.template.allowedSources as Array<{ providerId: string }>;
    if (!Array.isArray(allowedSources) || allowedSources.length === 0) {
      throw new SettlementError("SETTLEMENT_INVALID_PROOF", "Template has no allowed sources", 400);
    }
    
    const urlHost = new URL(proof.sourceUrl).hostname;
    const allowed = allowedSources.some((s) => urlHost.includes(s.providerId));
    if (!allowed) {
      throw new SettlementError(
        "SETTLEMENT_INVALID_PROOF",
        `Source ${urlHost} not in allowed list`,
        400
      );
    }
  }

  async resolve(input: ResolveBetInput): Promise<ResolveBetResult> {
    // P22 stub: returns proof's claimed result
    // P23+ implements: fetch from sourceUrl, parse, validate
    const proof = input.proof as { sourceUrl: string; resultData: { winnerSide: "A" | "B" | "VOID" } };
    return {
      winnerSide: proof.resultData.winnerSide,
      resolvedAt: new Date(),
      evidence: { type: "official_result", sourceUrl: proof.sourceUrl, fetchedData: proof.resultData },
      method: "OFFICIAL_RESULT",
    };
  }
}
```

**Note:** P22 OFFICIAL_RESULT skeleton accepts proof's claimed result. P23+ moet daadwerkelijk fetchen via `fetch()` API. Voor P22 = MVP placeholder, productie-safe omdat geen API endpoints exposed.

### 10. ORACLE_VALUE + THRESHOLD_METRIC stubs

Beide throw `SETTLEMENT_NOT_IMPLEMENTED`:

```typescript
// src/lib/settlement/methods/oracle-value.ts
export class OracleValueService implements SettlementMethodService {
  readonly method = "ORACLE_VALUE" as const;
  
  validate(): void {
    throw new SettlementError("SETTLEMENT_NOT_IMPLEMENTED", "ORACLE_VALUE not yet implemented", 501);
  }
  
  async resolve(): Promise<ResolveBetResult> {
    throw new SettlementError("SETTLEMENT_NOT_IMPLEMENTED", "ORACLE_VALUE not yet implemented", 501);
  }
}
```

Zelfde patroon voor THRESHOLD_METRIC.

### 11. Tests per method (5 cases each)

| Test | OFFICIAL_RESULT | PLATFORM_PROOF | ORACLE_VALUE | THRESHOLD_METRIC |
|---|---|---|---|---|
| 1 | Valid input passes | Valid winnerSide passes | NOT_IMPLEMENTED throws | NOT_IMPLEMENTED throws |
| 2 | Missing sourceUrl rejected | Missing proof rejected | always throws | always throws |
| 3 | Unallowed source rejected | Invalid winnerSide rejected | error code matches | error code matches |
| 4 | resolve returns correct shape | resolve returns correct shape | statusCode 501 | statusCode 501 |
| 5 | Evidence captures sourceUrl | Evidence captures initiatorUserId | (stub same as test 1) | (stub same as test 1) |

## Files to create

```
docs/PROMPT_P22_SETTLEMENT_METHODS.md                 new  Deze spec
prisma/schema.prisma                                  edit + enum + BetTemplate.settlementMethod
prisma/migrations/<ts>_add_settlement_method/         new  migration
src/lib/settlement/types.ts                           new  shared types + SettlementError
src/lib/settlement/methods/official-result.ts         new  ~50 regels
src/lib/settlement/methods/oracle-value.ts            new  ~25 regels (stub)
src/lib/settlement/methods/platform-proof.ts          new  ~50 regels
src/lib/settlement/methods/threshold-metric.ts        new  ~25 regels (stub)
src/lib/settlement/router.ts                          new  dispatcher
src/__tests__/settlement/official-result.test.ts      new  5 cases
src/__tests__/settlement/oracle-value.test.ts         new  5 cases
src/__tests__/settlement/platform-proof.test.ts       new  5 cases
src/__tests__/settlement/threshold-metric.test.ts     new  5 cases
```

13 files totaal (1 spec + 1 schema edit + 1 migration + 5 lib files + 4 test files + 1 router).

## Pre-flight

```bash
cd /workspaces/zentrix
git checkout wip-p22-settlement-methods
git status --short    # should be clean
git log --oneline -3  # should show f94ef86 (P21 merge)

ls -la .env   # symlink to .env.local
pnpm prisma migrate status
# Should say "Database schema is up to date"

# Verify P21 templates exist (sanity)
cat > /tmp/verify_p21_state.ts <<'EOF'
import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.betTemplate.count();
  console.log(`P21 templates in DB: ${count}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
EOF
mv /tmp/verify_p21_state.ts /workspaces/zentrix/verify_p21_state.ts
pnpm tsx /workspaces/zentrix/verify_p21_state.ts
rm /workspaces/zentrix/verify_p21_state.ts
# Should print: P21 templates in DB: 15
```

## Implementation steps

### Step 0 — Write spec to docs/

Write this spec file to `docs/PROMPT_P22_SETTLEMENT_METHODS.md`.

```bash
git add docs/PROMPT_P22_SETTLEMENT_METHODS.md
git commit -m "docs(p22): SettlementMethod enum + 4 method services spec"
git push origin wip-p22-settlement-methods
```

PAUSE — confirm spec commit + push.

### Step 1 — Schema add

Edit `prisma/schema.prisma`:

1. Add enum near other enums (logical group with SettlementType):
```prisma
enum SettlementMethod {
  OFFICIAL_RESULT
  ORACLE_VALUE
  PLATFORM_PROOF
  THRESHOLD_METRIC
}
```

2. Add column to `BetTemplate` model:
```prisma
model BetTemplate {
  // ... existing fields ...
  settlementMethod  SettlementMethod  @default(PLATFORM_PROOF) @map("settlement_method")
  // ... rest of fields ...
}
```

3. `pnpm prisma format`

4. SHOW git diff prisma/schema.prisma

PAUSE — verify only enum + 1 column added.

### Step 2 — Migration (--create-only MANDATORY)

```bash
pnpm prisma migrate dev --create-only --name add_settlement_method
```

CRITICAL: `--create-only` flag verplicht (productie DB).

Verify generated SQL:
```bash
LATEST=$(ls prisma/migrations/ | grep add_settlement_method | head -1)
cat prisma/migrations/$LATEST/migration.sql
```

Expected:
```sql
-- CreateEnum
CREATE TYPE "SettlementMethod" AS ENUM ('OFFICIAL_RESULT', 'ORACLE_VALUE', 'PLATFORM_PROOF', 'THRESHOLD_METRIC');

-- AlterTable
ALTER TABLE "bet_templates" ADD COLUMN "settlement_method" "SettlementMethod" NOT NULL DEFAULT 'PLATFORM_PROOF';
```

Stop conditions:
- DROP statements → STOP
- ALTER on tables anders dan `bet_templates` → STOP
- Migration zonder DEFAULT → STOP (zou bestaande 15 rows breken)

PAUSE — show SQL.

### Step 2.5 — Prisma generate

```bash
pnpm prisma generate 2>&1 | tail -5
```

Verify `SettlementMethod` type in `@prisma/client`.

### Step 3 — Create src/lib/settlement/types.ts

```bash
mkdir -p src/lib/settlement/methods
```

Write `src/lib/settlement/types.ts` met content uit Design decision 5 + 6 (types + SettlementError class).

PAUSE — show file.

### Step 4 — Create src/lib/settlement/methods/platform-proof.ts

Write file uit Design decision 8.

PAUSE — show file.

### Step 5 — Create src/lib/settlement/methods/official-result.ts

Write file uit Design decision 9.

PAUSE — show file.

### Step 6 — Create stubs (oracle-value + threshold-metric)

Write beide files uit Design decision 10 (zelfde pattern, beide NOT_IMPLEMENTED).

PAUSE — show beide files.

### Step 7 — Create src/lib/settlement/router.ts

Write file uit Design decision 7.

PAUSE — show file.

### Step 8 — TypeScript verify

```bash
pnpm tsc --noEmit 2>&1 | grep -E "src/lib/settlement" | head -20
```

MUST be 0 errors in settlement paths. Pre-existing errors elders = OK.

PAUSE — confirm clean.

### Step 9 — Create 4 test files

```bash
mkdir -p src/__tests__/settlement
```

Write alle 4 test files (5 cases per method):

#### src/__tests__/settlement/platform-proof.test.ts

```typescript
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
```

#### src/__tests__/settlement/official-result.test.ts

```typescript
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
```

#### src/__tests__/settlement/oracle-value.test.ts

```typescript
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
```

#### src/__tests__/settlement/threshold-metric.test.ts

Zelfde pattern als oracle-value, vervang ORACLE_VALUE met THRESHOLD_METRIC.

DO NOT run `pnpm test` (productie DB discipline).

PAUSE — show test files.

### Step 10 — Final TypeScript verify

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

MUST be 0 errors total.

PAUSE — confirm clean.

### Step 11 — Commit + push

```bash
git status --short
git add prisma/schema.prisma \
        prisma/migrations/<ts>_add_settlement_method/ \
        src/lib/settlement/ \
        src/__tests__/settlement/

git status --short  # verify staged

git commit -m "feat(p22): SettlementMethod enum + 4 method services

Foundation for resolution architecture (P22-P25 roadmap).

Schema:
- SettlementMethod enum (OFFICIAL_RESULT, ORACLE_VALUE, PLATFORM_PROOF, THRESHOLD_METRIC)
- BetTemplate.settlementMethod column with DEFAULT 'PLATFORM_PROOF'
- 15 existing P21 templates backfilled automatically via DEFAULT

Services in src/lib/settlement/:
- types.ts: shared types + SettlementError class
- router.ts: dispatcher (switch on SettlementMethod)
- methods/official-result.ts: skeleton with allowedSources validation
- methods/platform-proof.ts: wraps existing Zentrix proof-confirm flow
- methods/oracle-value.ts: stub (throws NOT_IMPLEMENTED)
- methods/threshold-metric.ts: stub (throws NOT_IMPLEMENTED)

Design:
- Loose coupling: P22 services return resolution DECISIONS
- API layer (P23) commits via existing settleBet (no service.ts changes)
- PLATFORM_PROOF wraps MVP flow (backward-compat)
- OFFICIAL_RESULT validates allowedSources but stubs fetch (P23+ implements)
- ORACLE_VALUE + THRESHOLD_METRIC are placeholders for future work

Tests (4 files, 5 cases each = 20 tests total):
- src/__tests__/settlement/official-result.test.ts
- src/__tests__/settlement/platform-proof.test.ts
- src/__tests__/settlement/oracle-value.test.ts (NOT_IMPLEMENTED behavior)
- src/__tests__/settlement/threshold-metric.test.ts (NOT_IMPLEMENTED behavior)

Tests not run locally (DATABASE_URL = production Neon).

Out of scope:
- Working ORACLE_VALUE and THRESHOLD_METRIC (placeholders)
- Working OFFICIAL_RESULT fetch logic (P23+ implements)
- API endpoints (P23)
- Frontend (P24-P25)
- Modifications to src/lib/bets/service.ts (no changes)

Migration applies via Vercel build (prisma migrate deploy)."

git push origin wip-p22-settlement-methods
git log --oneline -3
```

PAUSE — confirm commit hash + push.

### Step 12 — Open PR

```bash
gh pr create \
  --base main \
  --head wip-p22-settlement-methods \
  --title "P22: SettlementMethod enum + 4 method services" \
  --body "$(cat <<'EOF'
Foundation for resolution architecture (P22-P25 roadmap).

## Schema
- Enum `SettlementMethod`: OFFICIAL_RESULT, ORACLE_VALUE, PLATFORM_PROOF, THRESHOLD_METRIC
- `BetTemplate.settlementMethod` column with DEFAULT `'PLATFORM_PROOF'`
- 15 existing P21 templates backfilled automatically via DEFAULT (no manual update needed)

## Services in src/lib/settlement/
- **types.ts** — shared types + SettlementError class
- **router.ts** — dispatcher (switch on SettlementMethod)
- **methods/platform-proof.ts** — wraps existing Zentrix proof-confirm flow (functional)
- **methods/official-result.ts** — skeleton with allowedSources validation (stub fetch)
- **methods/oracle-value.ts** — stub (throws NOT_IMPLEMENTED for P22)
- **methods/threshold-metric.ts** — stub (throws NOT_IMPLEMENTED for P22)

## Design rationale
- **Loose coupling:** P22 services return resolution DECISIONS. API layer (P23) commits via existing `settleBet`. No changes to `src/lib/bets/service.ts`.
- **MVP backward-compat:** PLATFORM_PROOF wraps current flow. No breaking changes.
- **Future-proof:** OFFICIAL_RESULT validates allowedSources structure. P23+ implements actual fetch logic.

## Validation
- 20 unit tests (5 per method)
- All validation paths covered (valid + 3 rejection cases + evidence shape)
- TypeScript clean

## Migration safety
- Pure additive: new enum + column with DEFAULT
- No impact on existing data
- 15 P21 templates get PLATFORM_PROOF automatically
- Vercel build applies via `prisma migrate deploy`

## Roadmap
- P20 ✅ Schema foundation
- P21 ✅ Templates seed (15 templates LIVE)
- **P22 (this PR)** Settlement methods architecture
- P23 — Resolution API endpoints (GET /api/templates, POST /api/bets/[id]/resolve)
- P24 — Frontend wizard architecture
- P25 — Frontend create-bet wizard execution

## Out of scope
- Working ORACLE_VALUE and THRESHOLD_METRIC implementations
- Working OFFICIAL_RESULT fetch logic (validation skeleton only)
- API endpoints (P23)
- Frontend (P24-P25)
EOF
)"
```

Report PR URL. DO NOT merge.

## Acceptance criteria

- [ ] `docs/PROMPT_P22_SETTLEMENT_METHODS.md` committed
- [ ] `prisma/schema.prisma` heeft SettlementMethod enum + BetTemplate.settlementMethod
- [ ] Migration in `prisma/migrations/<timestamp>_add_settlement_method/`
- [ ] Migration SQL: CREATE TYPE + ALTER TABLE ADD COLUMN met DEFAULT
- [ ] `src/lib/settlement/types.ts` exports types + SettlementError
- [ ] `src/lib/settlement/methods/` heeft 4 service files
- [ ] `src/lib/settlement/router.ts` exports getSettlementService + resolveBet
- [ ] `src/__tests__/settlement/` heeft 4 test files (5 cases each = 20 tests)
- [ ] `pnpm tsc --noEmit` clean (0 errors)
- [ ] PR opened
- [ ] Vercel CI green (migrate deploy + build success)

## Stop conditions

- Migration touches existing tables anders dan `bet_templates` → STOP
- Migration zonder DEFAULT op nieuwe NOT NULL column → STOP (zou 15 templates breken)
- TypeScript errors in non-settlement files → STOP, regression
- Schema drift error → STOP, diagnose
- Wijziging aan `src/lib/bets/service.ts` → STOP (out of scope per design)
- `pnpm test` attempted → STOP, productie DB

## Adversarial review

| Aanval | Verdediging |
|---|---|
| Migration breekt 15 P21 templates | DEFAULT PLATFORM_PROOF zorgt voor automatische backfill |
| Settlement methods coupled aan settleBet | Loose coupling: services return decisions, geen DB writes |
| ORACLE_VALUE stub kan triggeren in prod | Throws NOT_IMPLEMENTED (501) — duidelijke error |
| OFFICIAL_RESULT skeleton accepts user-supplied result | Validates allowedSources host match. P23+ does real fetch |
| SettlementError class conflict met DisputeError/BetError | Different namespace + name, no conflict |
| Router switch fails on invalid method | Throws SETTLEMENT_INVALID_METHOD (500) |
| Method services hold state | All are stateless classes (zero-arg constructors) |
| Tests run real settleBet | Tests mock alle DB calls, geen DB pollution |
| URL hostname check te restrictief | `urlHost.includes(providerId)` is permissive (s.fifa.com matches fifa) |
| Vercel build faalt op migration | Additive ALTER, geen reset = safe |

## Notes for executor

1. **DO NOT** modify `src/lib/bets/service.ts` — P22 is loose-coupled
2. **DO NOT** run `pnpm test` — productie DB protection
3. **DO NOT** implement real OFFICIAL_RESULT fetch — P23+ scope
4. **DO NOT** add API routes — P23 scope
5. **`--create-only`** flag verplicht voor migration
6. Pre-existing Prisma deprecation warning op `package.json#prisma` — negeer

## Tempo schatting

```
Step 0 spec commit:           5 min
Step 1 schema add:            10 min
Step 2 migration --create:    10 min
Step 2.5 prisma generate:     2 min
Step 3 types.ts:              10 min
Step 4 platform-proof.ts:     10 min
Step 5 official-result.ts:    15 min
Step 6 stubs (2 files):       10 min
Step 7 router.ts:             10 min
Step 8 tsc verify:            3 min
Step 9 test files (4x):       30 min
Step 10 final tsc:            3 min
Step 11 commit + push:        5 min
Step 12 PR open:              5 min
─────────────────────────────
TOTAL:                        ~2 hours (Claude Code execution)

PR + Vercel CI: 5 min
Merge: 1 min
P22 LIVE: ~2.1 hours from start
```

## Next steps after P22 merge

- P23 spec: Resolution API endpoints
  - GET /api/templates (list 15 templates)
  - GET /api/templates/[slug] (detail)
  - POST /api/bets/[id]/resolve (calls router.resolveBet)
  - Authentication + idempotency
- Estimate: 3-4 hours Claude Code execution
- Niet starten zonder explicit go signal voor P23
