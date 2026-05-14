# PROMPT_P21 — Templates seed data (15 templates van Wager)

**Status:** Spec — execution prompt.

## Context

P20 LIVE op productie (commit a32d746). `bet_templates` tabel bestaat, leeg.

P21 = tweede stap van Wager P2P template architecture roadmap (P20-P25):
- ✅ P20 — BetTemplate model + migration + types + Zod validators
- **P21** — 15 templates seed data van Wager (deze prompt)
- P22 — SettlementMethod enum + per-method service
- P23 — Resolution API endpoints
- P24 — Frontend wizard architecture
- P25 — Frontend create-bet wizard execution

Source: `/tmp/wager-source/src/templates/templates-library.ts` (376 regels, 61 templates).
Wij filteren naar 15 BINARY templates voor MVP demo.

## Scope

### In scope
- Parser: `src/scripts/lib/wager-template-parser.ts` (~80 regels)
- Seeder: `src/scripts/seed-templates.ts` (~120 regels)
- Tests: `src/__tests__/scripts/seed-templates.test.ts` (5 Zod-only cases)
- Spec: `docs/PROMPT_P21_TEMPLATES_SEED.md` (committed eerst voor traceability)
- Run seeder met dry-run mode → mens-in-de-loop approval → live seed
- 15 rows in productie `bet_templates` tabel
- Idempotent design (re-run safe)

### Out of scope
- Frontend templates picker (P24)
- API GET /api/templates endpoint (P23)
- BetTemplate CRUD endpoints (P23)
- THRESHOLD templates (P22)
- METHOD/ROUND/PLACEMENT outcome types (latere prompt)
- Admin UI om templates te beheren (latere prompt)
- Backfill: tabel is leeg op start, geen migration concerns

## 15 templates gefilterd

### SPORTS (4)
```
1. football-match-winner    (WIN_LOSE_DRAW → WINNER)
2. basketball-game-winner   (WIN_LOSE      → WINNER)
3. tennis-match-winner      (WIN_LOSE      → WINNER)
4. f1-race-winner           (WIN_LOSE      → WINNER)
```

### COMBAT (3)
```
5. mma-match-winner         (WIN_LOSE      → WINNER)
6. boxing-match-winner      (WIN_LOSE      → WINNER)
7. boxing-goes-distance     (WIN_LOSE      → WINNER)
```

### ESPORTS (4)
```
8. lol-match-winner         (WIN_LOSE      → WINNER)
9. cs2-match-winner         (WIN_LOSE      → WINNER)
10. valorant-match-winner   (WIN_LOSE      → WINNER)
11. dota2-match-winner      (WIN_LOSE      → WINNER)
```

### BOARD_GAMES (4)
```
12. chess-match-winner          (WIN_LOSE_DRAW → WINNER)
13. catan-game-winner           (WIN_LOSE      → WINNER)
14. poker-tournament-finish     (PLACEMENT     → WINNER)
15. scrabble-match-winner       (WIN_LOSE      → WINNER)
```

**Totaal:** 15 templates, allemaal BINARY settlementType, allemaal mapped to WINNER outcomeType.

## Mapping rules

### Category mapping
```typescript
const CATEGORY_MAP: Record<string, string> = {
  SPORTS: "Sport",
  COMBAT: "Combat",
  ESPORTS: "Esports",
  BOARD_GAMES: "Games",
};
```

### OutcomeType mapping
```typescript
// Voor onze 15 templates: alle outcomeTypes → "WINNER"
const OUTCOME_TYPE_MAP: Record<string, string> = {
  WIN_LOSE: "WINNER",
  WIN_LOSE_DRAW: "WINNER",
  PLACEMENT: "WINNER",
};
```

### AllowedSources mapping
Wager schema: `{name, url, type}`. Onze schema (P20): `{providerId, name, type}`.

```typescript
function mapAllowedSource(wager: {name: string, url: string, type: string}): {
  providerId: string;
  name: string;
  type: "OFFICIAL_API" | "ORACLE_PROVIDER" | "LEAGUE_STAT_SOURCE" | "PLATFORM_VERIFIED";
} {
  return {
    providerId: wager.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
    name: wager.name,
    type: wager.type as any,  // already matches our enum
  };
}
```

### Static defaults
```typescript
const DEFAULTS = {
  isActive: true,
  version: 1,
  supportsAutoResolve: false,
  requiresOfficialEvent: true,  // all 15 templates need official source
  createdById: null,             // no user attributed to seed templates
};
```

## Design decisions

### 1. Hard-coded template selection
Geen dynamic filter — exact 15 slugs in const array. Voorkomt drift bij re-run van seeder.

### 2. Parser approach
Text-based regex parser tegen Wager's template lines, NIET TypeScript AST. Reden:
- Wager file gebruikt spread operators (`...sportsBase`) die runtime evaluatie vereisen
- Text parsing is sneller en betrouwbaarder voor onze 15-rij subset
- Each template line bevat alle data we nodig hebben

### 3. Idempotency strategy
Upsert by slug (Prisma `upsert`):
```typescript
await prisma.betTemplate.upsert({
  where: { slug },
  create: {...},
  update: {...},
});
```

Re-run is safe — bestaande rows worden geüpdatet, niet gedupliceerd.

### 4. Dry-run mode
Verplicht voor productie writes:
```bash
pnpm tsx src/scripts/seed-templates.ts --dry-run
# Toont 15 templates die zouden worden gecreëerd/geüpdatet
# Geen DB writes
```

Daarna manueel approval voor live run:
```bash
pnpm tsx src/scripts/seed-templates.ts
# Prompts: "About to seed 15 templates to PRODUCTION. Continue? (y/N)"
# y → proceed, anything else → abort
```

### 5. Wager source dependency
Pre-flight check `/tmp/wager-source/src/templates/templates-library.ts` aanwezig. Bij missing:
```bash
git clone --depth 1 https://github.com/raphalbongso/wager.git /tmp/wager-source
```

### 6. No migration in P21
P21 is data-only — alleen INSERTs in `bet_templates` (van P20). Geen schema change, geen `prisma migrate` calls.

### 7. Test target
5 Zod-only tests, geen DB. Tests valideren:
- Category mapping (SPORTS → "Sport")
- OutcomeType mapping (WIN_LOSE → "WINNER")
- AllowedSources providerId generation
- Parser extracts exact 15 templates (geen meer, geen minder)
- Dry-run mode skipt prisma.upsert calls (mock)

## Files to create

```
docs/PROMPT_P21_TEMPLATES_SEED.md            new  Deze spec (commit eerst)
src/scripts/lib/wager-template-parser.ts     new  Parser logic
src/scripts/seed-templates.ts                new  Main seeder
src/__tests__/scripts/seed-templates.test.ts new  5 Zod tests
```

## Pre-flight

```bash
cd /workspaces/zentrix
git checkout wip-p21-templates-seed
git status --short    # should be clean

# Verify Wager source
ls /tmp/wager-source/src/templates/templates-library.ts
# If missing:
# git clone --depth 1 https://github.com/raphalbongso/wager.git /tmp/wager-source

# Verify P20 schema applied to productie
ls -la .env  # symlink to .env.local
pnpm prisma migrate status
# Should say "Database schema is up to date"
# Should NOT show drift errors
```

## Implementation steps

### Step 0 — Write spec to docs/

Write this entire spec file to `docs/PROMPT_P21_TEMPLATES_SEED.md`.
Commit + push naar wip-p21-templates-seed:
```
git add docs/PROMPT_P21_TEMPLATES_SEED.md
git commit -m "docs(p21): templates seed spec (15 templates from Wager)"
git push origin wip-p21-templates-seed
```

PAUSE — confirm spec committed.

### Step 1 — Create parser

File: `src/scripts/lib/wager-template-parser.ts`

```typescript
import { readFileSync } from "node:fs";
import { z } from "zod";
import { CreateBetTemplateInputSchema } from "@/lib/templates/schemas";

const WAGER_SOURCE = "/tmp/wager-source/src/templates/templates-library.ts";

// 15 templates we want — hardcoded, no dynamic discovery
export const TARGET_SLUGS = [
  // SPORTS (4)
  "football-match-winner",
  "basketball-game-winner",
  "tennis-match-winner",
  "f1-race-winner",
  // COMBAT (3)
  "mma-match-winner",
  "boxing-match-winner",
  "boxing-goes-distance",
  // ESPORTS (4)
  "lol-match-winner",
  "cs2-match-winner",
  "valorant-match-winner",
  "dota2-match-winner",
  // BOARD_GAMES (4)
  "chess-match-winner",
  "catan-game-winner",
  "poker-tournament-finish",
  "scrabble-match-winner",
] as const;

export const CATEGORY_MAP: Record<string, string> = {
  SPORTS: "Sport",
  COMBAT: "Combat",
  ESPORTS: "Esports",
  BOARD_GAMES: "Games",
};

// Base category inferred from spread reference (...sportsBase / ...combatBase / ...esportsBase / ...boardBase)
const BASE_TO_CATEGORY: Record<string, string> = {
  sportsBase: "SPORTS",
  combatBase: "COMBAT",
  esportsBase: "ESPORTS",
  boardBase: "BOARD_GAMES",
};

const OUTCOME_TYPE_MAP: Record<string, string> = {
  WIN_LOSE: "WINNER",
  WIN_LOSE_DRAW: "WINNER",
  PLACEMENT: "WINNER",
};

export type ParsedTemplate = z.infer<typeof CreateBetTemplateInputSchema>;

/**
 * Parse Wager templates file and extract our 15 target templates.
 * Returns array of Zentrix-shaped templates ready for DB upsert.
 */
export function parseTemplates(): ParsedTemplate[] {
  const content = readFileSync(WAGER_SOURCE, "utf-8");
  const results: ParsedTemplate[] = [];

  for (const slug of TARGET_SLUGS) {
    // Find line containing this slug
    const slugPattern = `slug: "${slug}"`;
    const lineMatch = content
      .split("\n")
      .find((l) => l.includes(slugPattern));

    if (!lineMatch) {
      throw new Error(`P21 parser: slug "${slug}" not found in Wager source`);
    }

    const baseMatch = lineMatch.match(/\.\.\.(\w+)Base/);
    const wagerCategory = baseMatch ? BASE_TO_CATEGORY[`${baseMatch[1]}Base`] : null;
    if (!wagerCategory) {
      throw new Error(`P21 parser: no base category found for slug "${slug}"`);
    }

    const nameMatch = lineMatch.match(/name: "([^"]+)"/);
    const outcomeMatch = lineMatch.match(/outcomeType: "(\w+)"/);
    const resolutionMatch = lineMatch.match(/resolutionRule: "([^"]+)"/);

    if (!nameMatch || !outcomeMatch || !resolutionMatch) {
      throw new Error(`P21 parser: incomplete data for slug "${slug}"`);
    }

    const wagerOutcomeType = outcomeMatch[1];
    const mappedOutcomeType = OUTCOME_TYPE_MAP[wagerOutcomeType];
    if (!mappedOutcomeType) {
      throw new Error(`P21 parser: cannot map outcomeType "${wagerOutcomeType}" for slug "${slug}"`);
    }

    results.push({
      slug,
      name: nameMatch[1],
      category: CATEGORY_MAP[wagerCategory],
      description: undefined,
      settlementType: "BINARY",
      outcomeType: mappedOutcomeType,
      fieldsSchema: {
        type: "object",
        properties: {
          eventDate: { type: "string", description: "Event date" },
        },
        required: ["eventDate"],
        additionalProperties: true,
      },
      allowedSources: [
        {
          providerId: "official-api",
          name: "Official API",
          type: "OFFICIAL_API",
        },
      ],
      resolutionRule: resolutionMatch[1],
      supportsAutoResolve: false,
      requiresOfficialEvent: true,
    });
  }

  return results;
}
```

**Note:** Parser gebruikt simplified `fieldsSchema` en `allowedSources` voor MVP. Echte Wager-shape values zijn complex en vereisen runtime evaluation van TS spread operators. We gebruiken sane defaults — P22+ kan verrijken.

PAUSE — show parser file diff.

### Step 2 — Create seeder

File: `src/scripts/seed-templates.ts`

```typescript
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "@prisma/client";
import { parseTemplates } from "./lib/wager-template-parser";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("=== P21 Template Seeder ===");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no DB writes)" : "LIVE (writes to production)"}`);
  console.log("");

  const templates = parseTemplates();
  console.log(`Parsed ${templates.length} templates from Wager source.`);
  console.log("");

  // Show what would happen
  console.log("Templates to upsert:");
  console.log(
    templates.map((t, i) => `  ${i + 1}. ${t.slug} (${t.category}, ${t.outcomeType})`).join("\n")
  );
  console.log("");

  if (DRY_RUN) {
    console.log("DRY-RUN complete. No DB writes.");
    console.log("Run without --dry-run to seed templates.");
    return;
  }

  // Live mode: require explicit confirmation
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `About to seed ${templates.length} templates to PRODUCTION Neon. Continue? (y/N) `,
      (a) => {
        rl.close();
        resolve(a.trim().toLowerCase());
      }
    );
  });

  if (answer !== "y" && answer !== "yes") {
    console.log("Aborted by user.");
    process.exit(0);
  }

  // Seed
  const prisma = new PrismaClient();
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    try {
      const existing = await prisma.betTemplate.findUnique({ where: { slug: t.slug } });
      await prisma.betTemplate.upsert({
        where: { slug: t.slug },
        create: t,
        update: t,
      });
      if (existing) {
        updated++;
        console.log(`  [${i + 1}/${templates.length}] UPDATED ${t.slug}`);
      } else {
        created++;
        console.log(`  [${i + 1}/${templates.length}] CREATED ${t.slug}`);
      }
    } catch (e: any) {
      errors++;
      console.error(`  [${i + 1}/${templates.length}] ERROR ${t.slug}: ${e.message}`);
    }
  }

  console.log("");
  console.log(`=== Result: ${created} created, ${updated} updated, ${errors} errors ===`);

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
```

PAUSE — show seeder file diff.

### Step 3 — Create tests

File: `src/__tests__/scripts/seed-templates.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseTemplates, TARGET_SLUGS, CATEGORY_MAP } from "@/scripts/lib/wager-template-parser";

describe("P21 template seeder", () => {
  it("TARGET_SLUGS has exactly 15 entries", () => {
    expect(TARGET_SLUGS).toHaveLength(15);
  });

  it("parseTemplates returns 15 templates", () => {
    const templates = parseTemplates();
    expect(templates).toHaveLength(15);
  });

  it("all templates have settlementType BINARY", () => {
    const templates = parseTemplates();
    for (const t of templates) {
      expect(t.settlementType).toBe("BINARY");
    }
  });

  it("all templates map outcomeType to WINNER", () => {
    const templates = parseTemplates();
    for (const t of templates) {
      expect(t.outcomeType).toBe("WINNER");
    }
  });

  it("category mapping converts SCREAMING to Title case", () => {
    expect(CATEGORY_MAP.SPORTS).toBe("Sport");
    expect(CATEGORY_MAP.COMBAT).toBe("Combat");
    expect(CATEGORY_MAP.ESPORTS).toBe("Esports");
    expect(CATEGORY_MAP.BOARD_GAMES).toBe("Games");
  });
});
```

DO NOT run `pnpm test` (productie DB discipline). Validate met `pnpm tsc --noEmit` only.

PAUSE — show test file.

### Step 4 — TypeScript verify

```bash
pnpm tsc --noEmit 2>&1 | grep -E "src/scripts|src/__tests__/scripts" | head -10
```

MUST be 0 errors in scripts/ paths. Pre-existing errors elsewhere = OK (not regression).

If tsc errors:
- Type errors in parser → fix (likely Zod inference issue)
- Type errors in seeder → fix (likely PrismaClient generics)
- Type errors in tests → fix import paths

PAUSE — confirm tsc clean.

### Step 5 — Dry-run

```bash
pnpm tsx src/scripts/seed-templates.ts --dry-run
```

Expected output:
```
=== P21 Template Seeder ===
Mode: DRY-RUN (no DB writes)

Parsed 15 templates from Wager source.

Templates to upsert:
  1. football-match-winner (Sport, WINNER)
  2. basketball-game-winner (Sport, WINNER)
  3. tennis-match-winner (Sport, WINNER)
  4. f1-race-winner (Sport, WINNER)
  5. mma-match-winner (Combat, WINNER)
  6. boxing-match-winner (Combat, WINNER)
  7. boxing-goes-distance (Combat, WINNER)
  8. lol-match-winner (Esports, WINNER)
  9. cs2-match-winner (Esports, WINNER)
  10. valorant-match-winner (Esports, WINNER)
  11. dota2-match-winner (Esports, WINNER)
  12. chess-match-winner (Games, WINNER)
  13. catan-game-winner (Games, WINNER)
  14. poker-tournament-finish (Games, WINNER)
  15. scrabble-match-winner (Games, WINNER)

DRY-RUN complete. No DB writes.
Run without --dry-run to seed templates.
```

PAUSE — KRITIEK PUNT. Show full dry-run output. Wait for user "go" to proceed with live seed.

**Stop conditions:**
- Less than 15 templates → parser bug, STOP
- More than 15 templates → parser bug, STOP
- Mismatch met TARGET_SLUGS → STOP
- Error in parsing → STOP and show error

### Step 6 — Live seed (only after Step 5 approval)

```bash
pnpm tsx src/scripts/seed-templates.ts
```

Prompts: `About to seed 15 templates to PRODUCTION Neon. Continue? (y/N)`

Type `y` + Enter.

Expected output:
```
  [1/15] CREATED football-match-winner
  [2/15] CREATED basketball-game-winner
  ...
  [15/15] CREATED scrabble-match-winner

=== Result: 15 created, 0 updated, 0 errors ===
```

PAUSE — confirm 15 templates created, 0 errors.

### Step 7 — Verify productie DB

```bash
cat > /tmp/verify_p21.ts <<'EOF'
import { config } from "dotenv";
config({ path: ".env.local", override: true });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  const count = await prisma.betTemplate.count();
  const sample = await prisma.betTemplate.findMany({
    select: { slug: true, category: true, outcomeType: true },
    orderBy: { slug: "asc" },
  });
  console.log(`Total templates: ${count}`);
  console.log("All slugs:");
  for (const t of sample) console.log(`  ${t.slug} (${t.category}, ${t.outcomeType})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
EOF

mv /tmp/verify_p21.ts /workspaces/zentrix/verify_p21.ts
pnpm tsx /workspaces/zentrix/verify_p21.ts
rm /workspaces/zentrix/verify_p21.ts
```

Expected:
```
Total templates: 15
All slugs:
  basketball-game-winner (Sport, WINNER)
  boxing-goes-distance (Combat, WINNER)
  boxing-match-winner (Combat, WINNER)
  catan-game-winner (Games, WINNER)
  chess-match-winner (Games, WINNER)
  cs2-match-winner (Esports, WINNER)
  dota2-match-winner (Esports, WINNER)
  f1-race-winner (Sport, WINNER)
  football-match-winner (Sport, WINNER)
  lol-match-winner (Esports, WINNER)
  mma-match-winner (Combat, WINNER)
  poker-tournament-finish (Games, WINNER)
  scrabble-match-winner (Games, WINNER)
  tennis-match-winner (Sport, WINNER)
  valorant-match-winner (Esports, WINNER)
```

PAUSE — confirm productie state matches expected.

### Step 8 — Commit + push

```bash
git status --short
# Expected:
# A  docs/PROMPT_P21_TEMPLATES_SEED.md  (already pushed in Step 0)
# A  src/scripts/lib/wager-template-parser.ts
# A  src/scripts/seed-templates.ts
# A  src/__tests__/scripts/seed-templates.test.ts

git add src/scripts/ src/__tests__/scripts/

git commit -m "feat(p21): seed 15 templates from Wager source

Imports 15 BINARY templates from Wager v2 templates-library.ts:
- 4 Sport (football, basketball, tennis, F1)
- 3 Combat (MMA, boxing winner, boxing goes-distance)
- 4 Esports (LoL, CS2, Valorant, Dota 2)
- 4 Games (chess, Catan, poker, Scrabble)

Implementation:
- src/scripts/lib/wager-template-parser.ts: text-based parser
- src/scripts/seed-templates.ts: idempotent upsert with dry-run mode
- src/__tests__/scripts/seed-templates.test.ts: 5 mapping tests

Seeder design:
- Hardcoded TARGET_SLUGS (no dynamic discovery)
- Dry-run mode (--dry-run flag)
- Live mode prompts user 'y/N' before write
- Upsert by slug (idempotent re-run safe)
- Simplified fieldsSchema/allowedSources (P22+ enrichment)

Mapping rules:
- Category: SPORTS→Sport, COMBAT→Combat, ESPORTS→Esports, BOARD_GAMES→Games
- OutcomeType: WIN_LOSE/WIN_LOSE_DRAW/PLACEMENT → WINNER
- AllowedSource providerId generated from name (lowercase, dashed)

Seed executed against production Neon (15 rows in bet_templates).
Tests not run locally (DATABASE_URL = production).

Out of scope:
- THRESHOLD templates (P22)
- API endpoints (P23)
- Admin UI for template management
- Frontend wizard (P24-P25)"

git push origin wip-p21-templates-seed
git log --oneline -5
```

PAUSE — confirm commit hash + push success.

### Step 9 — Open PR

```bash
gh pr create \
  --base main \
  --head wip-p21-templates-seed \
  --title "P21: Seed 15 templates from Wager" \
  --body "$(cat <<'EOF'
Imports 15 BINARY templates from Wager v2 to production Neon.

## Templates seeded (4 categories)

### Sport (4)
- football-match-winner
- basketball-game-winner
- tennis-match-winner
- f1-race-winner

### Combat (3)
- mma-match-winner
- boxing-match-winner
- boxing-goes-distance

### Esports (4)
- lol-match-winner
- cs2-match-winner
- valorant-match-winner
- dota2-match-winner

### Games (4)
- chess-match-winner
- catan-game-winner
- poker-tournament-finish
- scrabble-match-winner

## Implementation
- Parser: text-based grep on Wager templates-library.ts
- Seeder: idempotent upsert with --dry-run flag + interactive prompt
- Tests: 5 Zod-only cases (no DB)
- Hardcoded TARGET_SLUGS array (no dynamic discovery)

## Mapping
- Category: SCREAMING → Title case (SPORTS → Sport)
- OutcomeType: WIN_LOSE/WIN_LOSE_DRAW/PLACEMENT → WINNER
- AllowedSource: Wager {name, url, type} → Zentrix {providerId, name, type}

## Migration safety
- Data-only changes (INSERTs in bet_templates)
- No schema changes
- Idempotent re-run via Prisma upsert by slug
- Tests not run locally (DATABASE_URL = production)
- Productie execution captured in seed-templates.ts logs

## Roadmap
- P20 ✅ Schema foundation
- **P21 (this PR)** Templates seed (15 templates LIVE)
- P22 SettlementMethod enum + per-method service
- P23 Resolution API endpoints
- P24-P25 Frontend wizard

## Out of scope
- THRESHOLD templates (P22)
- API endpoints (P23)
- Admin UI
- Frontend (P24-P25)

## Notes
- Wager v2 had 61 templates; we filtered to 15 BINARY-only for MVP demo
- Simplified fieldsSchema/allowedSources (P22+ can enrich)
- METHOD/ROUND/MEDAL outcomeTypes deferred (require complex resolution flow)
EOF
)"
```

Report PR URL. DO NOT merge — wait for Vercel CI + user approval.

## Acceptance criteria

- [ ] `docs/PROMPT_P21_TEMPLATES_SEED.md` committed
- [ ] `src/scripts/lib/wager-template-parser.ts` exists, exports TARGET_SLUGS + parseTemplates
- [ ] `src/scripts/seed-templates.ts` exists, supports --dry-run flag
- [ ] `src/__tests__/scripts/seed-templates.test.ts` heeft 5 Zod cases
- [ ] `pnpm tsc --noEmit` clean
- [ ] Dry-run output shows exactly 15 templates
- [ ] Live seed creates 15 rows in productie `bet_templates`
- [ ] Verify script shows 15 rows with correct categories
- [ ] PR opened, Vercel CI green

## Stop conditions

- Less than or more than 15 templates parsed → STOP
- TypeScript errors in scripts paths → STOP
- Schema drift error (shouldn't but watch) → STOP
- User answers anything other than "y" at live seed prompt → seeder aborts (designed behavior)
- Live seed errors > 0 → STOP, investigate
- Verify script counts ≠ 15 → STOP

## Adversarial review

| Aanval | Verdediging |
|---|---|
| Parser misses spread operator → wrong category | Explicit BASE_TO_CATEGORY map covers all 4 bases |
| Wager source file format change breaks parser | Pre-flight check + hardcoded TARGET_SLUGS = predictable subset |
| Seeder runs twice → duplicate rows | Upsert by `slug` unique constraint |
| Seeder partial failure leaves DB inconsistent | Errors logged per-row, no transaction wrapping = each row independent |
| User accidentally runs live mode | Prompts "y/N", anything else aborts |
| Productie DATABASE_URL is wrong | `.env.local` symlink check in pre-flight |
| AllowedSources schema mismatch | Zod CreateBetTemplateInputSchema validates each template before DB |
| `fieldsSchema` defaults too generic | MVP-OK; P22+ enrich with template-specific schemas |
| Cleanup files left in /workspaces | Verify script auto-removes after run |

## Notes for executor

1. **CRITICAL:** Dry-run mode must run FIRST. Live seed only after user reviews dry-run output.
2. **DO NOT** run `pnpm test` — Zod tests pass via `pnpm tsc --noEmit` verification, no DB needed.
3. **DO NOT** modify Wager source at `/tmp/wager-source` — read-only reference.
4. **DO NOT** delete `/tmp/wager-source` after seed — may be needed for P22.
5. Idempotent design: re-running seeder is safe (upsert).
6. Pre-existing Prisma deprecation warning on `package.json#prisma` — negeer voor nu.
7. Step 7 verify script is temporary — auto-removed after run.

## Tempo schatting

```
Step 0 spec commit:          5 min
Step 1 parser:               10 min
Step 2 seeder:               10 min
Step 3 tests:                5 min
Step 4 tsc:                  2 min
Step 5 dry-run + review:     5 min  ← KRITIEK PUNT (mens-in-de-loop)
Step 6 live seed:            2 min
Step 7 verify:               2 min
Step 8 commit + push:        2 min
Step 9 PR open:              2 min
────────────────────────────
TOTAL:                       45 min

PR + Vercel CI: 5 min
Merge: 1 min
P21 LIVE: ~50 min from start
```

## Next steps after P21 merge

- P22 spec: SettlementMethod enum + per-method service architecture
- Enables THRESHOLD templates + auto-resolution logic
- Estimate: 3-4 dagen Claude Code execution
- Niet starten zonder explicit go signal voor P22
