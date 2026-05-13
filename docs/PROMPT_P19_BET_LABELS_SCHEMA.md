# PROMPT_P19 — Bet labels schema (title + outcomeA + outcomeB)

**Status:** Spec — to be executed by Claude Code in Codespaces.

## Context

P18 frontend is merged to main (commit ea6a758). Vercel deploy groen.

Next milestone is **Wager-style create-bet UX** (PROMPT_WAGER_1). That requires
human-readable labels on each Bet. Current Bet model has only `creatorSide: "A"|"B"`
and `acceptorSide: "B"|"A"` — no titles, no outcome labels.

**This PROMPT adds 3 fields to the Bet model and updates all touch points.**

Reference: Wager source at /tmp/wager-source (already cloned). See
`src/components/open-bet/CreateOpenBetForm.tsx` for the canonical pattern.

## Scope

### In scope
- Prisma schema: add `title`, `outcomeA`, `outcomeB` to `Bet` model (all required strings)
- Prisma migration with safe defaults for existing rows
- `createBet` service body schema update (Zod)
- `createBet` service implementation update (pass-through to bet row)
- `POST /api/bets` route Body schema update
- `serializeBet` in `src/lib/http/serialize.ts` (add 3 new fields)
- Update existing createBet tests with new required fields
- Backwards-compat: existing bets in DB get DEFAULT '' values during migration

### Out of scope
- Frontend changes (separate PROMPT_WAGER_1)
- Fee logic (separate ADR, memory: "apart project niet in P15")
- Template system (BetTemplate model, separate Phase 2)
- Match label resolution from Pool/Match (separate task if ever needed)
- Backfill script for existing empty labels (acceptable to ship with '' until users edit)

## Files touched

```
prisma/schema.prisma                          edit  add 3 fields to model Bet
prisma/migrations/<timestamp>_add_bet_labels/ new   migration file
src/lib/bets/service.ts                       edit  createBet signature + insert
src/lib/bets/types.ts                         edit  CreateBetInput type
src/app/api/bets/route.ts                     edit  Body Zod schema
src/lib/http/serialize.ts                     edit  serializeBet returns 3 new fields
src/__tests__/bets/*.test.ts                      edit  all tests using createBet need new fields
```

## Design decisions

### 1. Field types
- `title: String` — required, min 1 char, max 200 chars
- `outcomeA: String` — required, min 1 char, max 100 chars
- `outcomeB: String` — required, min 1 char, max 100 chars

### 2. Migration safety
- Add columns with `DEFAULT ''` first
- Existing rows get empty strings (not NULL — keeps NOT NULL constraint)
- Frontend (PROMPT_WAGER_1) renders placeholders for empty values:
  - title: '' → "(untitled bet)"
  - outcomeA: '' → "Side A"
  - outcomeB: '' → "Side B"
- No backfill script. Existing bets are pre-launch test data, acceptable to ship with empty labels.

### 3. Body schema additions
Add to existing Zod Body in `src/app/api/bets/route.ts`:
```typescript
title: z.string().min(1).max(200),
outcomeA: z.string().min(1).max(100),
outcomeB: z.string().min(1).max(100),
```

### 4. Service signature update
`createBet({ creatorUserId, side, stakeUnits, expiresAt, poolId?, matchId? })` becomes
`createBet({ creatorUserId, side, stakeUnits, expiresAt, title, outcomeA, outcomeB, poolId?, matchId? })`.

Insert title/outcomeA/outcomeB into bet row alongside other fields. No validation
logic beyond Zod schema (the body parser handles it).

### 5. serializeBet update
Append to return object:
```typescript
title: bet.title,
outcomeA: bet.outcomeA,
outcomeB: bet.outcomeB,
```

Keep field order alphabetical-ish but place new fields near `creatorSide` / `acceptorSide`
for logical grouping.

### 6. Test updates
All existing tests in `src/__tests__/bets/` that call `createBet` need to pass the
3 new required fields. Sane test defaults:
```typescript
title: "Test bet",
outcomeA: "A wins",
outcomeB: "B wins",
```

Add 1 new test: `createBet rejects empty title/outcomeA/outcomeB → 400 bad_body`.

## Pre-flight (before starting)

1. Confirm baseline:
```bash
cd /workspaces/zentrix
git checkout main
git pull origin main
pnpm tsc --noEmit 2>&1 | tail -3   # should be clean (or only the reputation pre-existing errors)
pnpm test src/__tests__/bets/      # should be green
```

2. WIP branch:
```bash
git checkout -b wip-p19-bet-labels
```

3. Verify Wager source still in /tmp:
```bash
ls /tmp/wager-source/prisma/schema.prisma 2>/dev/null || echo "(re-clone needed)"
```
If re-clone needed:
```bash
cd /tmp && rm -rf wager-source && git clone --depth 1 https://github.com/raphalbongso/wager.git wager-source
```

## Implementation steps

### Step 1 — Prisma schema update
- Open `prisma/schema.prisma`
- Find `model Bet { ... }`
- Add after `acceptorSide`:
```
title       String  @default("")
outcomeA    String  @default("") @map("outcome_a")
outcomeB    String  @default("") @map("outcome_b")
```
- Use `@default("")` for safe migration of existing rows
- Commit: `feat(p19): add title + outcomeA + outcomeB to Bet model`

### Step 2 — Generate migration
```bash
pnpm prisma migrate dev --name add_bet_labels
# Verify: prisma/migrations/<timestamp>_add_bet_labels/migration.sql
# Should contain ALTER TABLE "bets" ADD COLUMN ...
```

If `pnpm prisma migrate dev` requires DB connection: ensure DATABASE_URL is set
in env (Codespaces should have it via Vercel pull).

If migration fails or schema drift detected: stop and report.


### Step 2.5 — Update package.json build for Vercel deploy
Edit package.json. Find:
```json
"build": "prisma generate && next build"
```

Change to:
```json
"build": "prisma migrate deploy && prisma generate && next build"
```

This makes Vercel run `prisma migrate deploy` (apply-only, no prompts) before
build. Production DB gets new columns at PR merge time, fail-safe.

### Step 3 — Update body schema in route
- Open `src/app/api/bets/route.ts`
- Locate the Zod `Body` schema for POST handler
- Add `title`, `outcomeA`, `outcomeB` with constraints from Design decision 3
- Verify route still TypeScript-compiles (with `prisma generate` rerun)

### Step 4 — Update createBet service
- Open `src/lib/bets/service.ts`
- Find `createBet` function signature
- Add `title`, `outcomeA`, `outcomeB` to input type
- Pass through to `prisma.bet.create({ data: { ..., title, outcomeA, outcomeB } })`
- Update `CreateBetInput` type in `src/lib/bets/types.ts`

### Step 5 — Update serializeBet
- Open `src/lib/http/serialize.ts`
- Find `serializeBet`
- Add 3 new fields to return object near creatorSide

### Step 6 — Update tests
- Run: `pnpm test src/__tests__/bets/ 2>&1 | head -40`
- For each TypeScript error about missing fields in `createBet({...})`:
  - Add `title: "Test bet"`, `outcomeA: "A wins"`, `outcomeB: "B wins"`
- Run again until green

### Step 7 — Add 1 new test
- File: `src/__tests__/bets/create-bet-labels.test.ts`
- Test cases:
  1. `createBet succeeds with valid title + outcomes`
  2. `createBet rejects empty title (Zod 400)`
  3. `createBet rejects title > 200 chars`
  4. `createBet rejects outcomeA empty`
  5. `createBet rejects outcomeB > 100 chars`
- Pattern: copy from `src/__tests__/bets/create-bet.test.ts` (if exists) or
  `src/__tests__/bets/bet-settlement.test.ts` setup

### Step 8 — Verify everything
```bash
cd /workspaces/zentrix
pnpm tsc --noEmit 2>&1 | tail -10
pnpm test src/__tests__/bets/ 2>&1 | tail -20
```

Both must be clean.

### Step 9 — Commit + push
```bash
git add prisma/ src/lib/bets/ src/app/api/bets/ src/lib/http/serialize.ts src/__tests__/bets/
git status --short
git commit -m "feat(p19): add title + outcomeA + outcomeB to Bet model

- Prisma migration adds 3 required string columns with DEFAULT '' for backward-compat
- createBet service signature extended; serializeBet returns new fields
- All existing tests updated with sane test data
- 5 new tests in create-bet-labels.test.ts validate Zod constraints

Enables PROMPT_WAGER_1 frontend (create-bet form with human-readable labels)."
git push origin wip-p19-bet-labels
```

### Step 10 — Open PR
```bash
gh pr create \
  --base main \
  --head wip-p19-bet-labels \
  --title "P19: Bet labels schema (title + outcomeA + outcomeB)" \
  --body "Adds 3 required string columns to Bet model. Enables Wager-style create-bet UX (PROMPT_WAGER_1).

## Migration safety
- All new columns are required (NOT NULL) but DEFAULT ''
- Existing bets get empty strings on migration (no backfill needed pre-launch)
- Frontend will render placeholders for empty values

## Test coverage
- All existing tests updated with sane test data
- 5 new tests verify Zod constraints (min/max length on each field)

## Out of scope
- Frontend changes — PROMPT_WAGER_1
- Fee logic — separate ADR
- Backfill of existing bets — acceptable to ship with empty labels"
```

Then wait for Vercel CI green, merge via GitHub UI.

## Acceptance criteria

- [ ] Prisma migration in `prisma/migrations/<timestamp>_add_bet_labels/`
- [ ] All TypeScript compiles clean
- [ ] All existing bet tests still green
- [ ] 5 new tests in `create-bet-labels.test.ts` all green
- [ ] `serializeBet` output includes title, outcomeA, outcomeB
- [ ] PR opened with body above
- [ ] Vercel CI green
- [ ] Merged to main

## Stop conditions

Stop immediately and report if:
- Prisma migration fails to apply (DB connection issue, schema drift)
- TypeScript errors in non-bet files (means I broke something unrelated)
- A pre-existing test breaks after my changes (regression)
- DATABASE_URL is missing in env (cannot run `prisma migrate dev`)
- Migration would touch other tables besides `bets` (means schema is wrong)
- A user wants to discuss / modify approach mid-execution — pause and ask

## Adversarial review (for my own confidence)

| Attack vector | Defense |
|---|---|
| Migration on production DB wipes data | DEFAULT '' on add, no DROP, no MODIFY existing data |
| Race condition: long-running migration locks bets table | Adding columns with DEFAULT is fast in Postgres (no full table rewrite for empty default) |
| Existing tests break en masse | Migrate tests first, verify green, THEN add new validation tests |
| Zod schema mismatch between route and service | Schema lives in route; service signature derived from it via type inference if possible, else manually kept in sync (comment in service) |
| Frontend P18 sees old serializer shape during deploy gap | serializeBet additions are backward-compatible (new fields, no removed fields) — old clients ignore them |
| Empty string '' passes Zod min(1) check | Zod `.min(1)` rejects empty strings — good. New tests verify this |

## Notes for executor

1. **Do not run** `prisma migrate reset` — this would wipe production data.
2. **Do not edit** the existing migration files in `prisma/migrations/` — only add new ones.
3. **If `prisma migrate dev` reports "schema drift"** — likely existing migration history doesn't match DB. Stop and report; investigate before proceeding.
4. Memory says backend has been working with Neon since P14. Migration should apply cleanly.
5. After PR merges, Vercel will redeploy. **Frontend P18 is still using old serializer shape** — that's fine, new fields are ignored by old code. Then PROMPT_WAGER_1 frontend can use the new fields.
