# PROMPT_08 — Pool Schema + Migration + Seed

**Doel:** Voeg de data-laag voor fase 2 toe (Pool, PoolEntry, DisputeLog, SettlementJob, 4 enums + extensies) aan `prisma/schema.prisma`. Inclusief Postgres trigger voor de R7-equivalent van phase 2: **creator-cannot-bet** (ADR-0002 mitigatie 1, DB-niveau). Geen routes, geen services, geen UI — alleen schema + migration + 5 invariant-tests.

**Builds on:** PROMPT_07 (observability) — commit `6ea7494`.
**Tijd:** ~1.5 uur Claude Code (waarvan ~30 min Postgres-trigger debugging op Windows).
**Files touched:**
- `prisma/schema.prisma` (extend, append-only)
- `prisma/migrations/<timestamp>_add_pool_schema/migration.sql` (new, edit-after-generate)
- `src/lib/env.ts` (extend met 8 vars)
- `vitest.config.ts` (mock 8 vars)
- `prisma/seed.ts` (geen wijzigingen — pools worden door users gemaakt; `BET_ESCROW` accounts on-demand)
- `src/__tests__/financial/pool-escrow-invariant.test.ts` (new — 5 schema-niveau tests)

**Wat dit prompt NIET doet:** geen `createPool` / `placeBet` services (PROMPT_09/10), geen API routes (PROMPT_11/12), geen settlement engine (PROMPT_13), geen UI (PROMPT_16). Alle status-transitie regels (bv. "winningSide alleen settable als status=SETTLEMENT_PENDING") zijn application-laag en horen in PROMPT_09 thuis — deze prompt voegt enkel de schema-shape en de creator-cannot-bet trigger toe.

**Beslissing vooraf vastgelegd (uit Doc-2 review op 2026-05-07):**
- DB-niveau enforcement van creator-cannot-bet → **Postgres BEFORE INSERT/UPDATE trigger** (geen CHECK met subquery, want die wordt in PG alleen row-niveau gevalideerd).
- Denormalized `totalSideAUnits` / `totalSideBUnits` op Pool: **behouden**, met recon-invariant in latere prompt.
- `VOID` enum-waarde alleen op `PoolWinningSide`, niet op `PoolSide`.
- **Hergebruik bestaande `AccountType.BET_ESCROW`** voor pool escrow accounts — geen aparte `POOL_ESCROW` waarde toevoegen. Reden: een pool-entry IS een bet, een pool's escrow IS een bet-escrow. Consistent met PHASE_2_DESIGN.md sectie 4.1. Bestaande seed.ts wijzigt niet.
- **Hergebruik `LedgerEntryType.SETTLEMENT_PAYOUT` en `FEE_COLLECTION`** (al aanwezig sinds PROMPT_04). **Toegevoegd**: `BET_PLACEMENT`, `BET_REFUND`. Optioneel: `BET_FEE_COLLECTION` als je analytics op pool-fees apart wilt filteren — voor MVP herbruiken we `FEE_COLLECTION`.

---

## Pre-flight

```powershell
Set-Location C:\Users\rapha\zentrix
git status                                                # clean
test -f docs\PHASE_2_DESIGN.md ; if ($?) { "phase 2 design present" }
git log --oneline -3                                       # 6ea7494 fase 1 head

# Heap voor migrate + generate
$env:NODE_OPTIONS = "--max-old-space-size=8192"
```

---

## ── BEGIN PROMPT ──

You are extending the zentrix Prisma schema for phase 2 (peer-to-peer pool wagering). The single most important rule for this prompt is: **the creator-cannot-bet check must live in the database, not just the API layer.** ADR-0002 mitigation 1 explicitly mandates DB-level enforcement, and Postgres CHECK constraints with subqueries are not enforced on cross-row UPDATE in PostgreSQL — therefore a trigger.

**Hard constraints:**

- Schema additions are **append-only**. Do not modify existing models. Do not rename existing enum values.
- Trigger is defined in raw SQL, edited into the Prisma-generated migration after `migrate dev --create-only`.
- Trigger covers both `INSERT` and `UPDATE` of `user_id` / `pool_id` on `pool_entries`.
- Migration name is exactly `add_pool_schema` (no version numbers, no "v2", no "fix" — see ADR-0001 D2).
- All new env vars are `.optional()` with sensible defaults; do not break existing tests.
- New invariant tests file follows the established cleanup discipline: per-test data is isolated, `afterAll` cleans up, no leakage to sibling test files.
- Test count must rise from **47 → 52** (5 new tests). If your final count differs, explain in the report.

---

### Step 1 — Extend env validation in `src/lib/env.ts`

Append to the `EnvSchema` object, after `PLATFORM_TREASURY_SCOPE`:

```typescript
  POOL_MIN_BET_USDC: z.string().default("1"),
  POOL_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(200), // 2%
  POOL_CREATOR_FEE_BPS_MIN: z.coerce.number().int().min(0).max(1000).default(100), // 1%
  POOL_CREATOR_FEE_BPS_MAX: z.coerce.number().int().min(0).max(1000).default(500), // 5%
  SETTLEMENT_DELAY_MIN_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  SETTLEMENT_DELAY_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  CREATOR_DECLARE_GRACE_HOURS: z.coerce.number().int().min(1).max(8760).default(168), // 7 days
  POOL_DISPUTE_HOLD_THRESHOLD_PCT: z.coerce.number().int().min(0).max(100).default(50),
```

All `.default(...)`, none required — bestaande tests die `getEnv()` aanroepen blijven groen.

`vitest.config.ts` env-block — add the 8 mocks (each with the same default value as the schema; use string for the bps ones so `z.coerce.number()` exercises its coercion path):

```typescript
      POOL_MIN_BET_USDC: "1",
      POOL_PLATFORM_FEE_BPS: "200",
      POOL_CREATOR_FEE_BPS_MIN: "100",
      POOL_CREATOR_FEE_BPS_MAX: "500",
      SETTLEMENT_DELAY_MIN_HOURS: "24",
      SETTLEMENT_DELAY_MAX_HOURS: "48",
      CREATOR_DECLARE_GRACE_HOURS: "168",
      POOL_DISPUTE_HOLD_THRESHOLD_PCT: "50",
```

**Validation:** `pnpm typecheck` after this step. Tests stay 47/47.

---

### Step 2 — Schema additions in `prisma/schema.prisma`

**Append at end of file**, after the `CircuitBreaker` model. Do not insert into existing enums in-place — Prisma allows enum extension only via append, and migration drift fights ordered enum values.

#### 2a — Extend `LedgerEntryType` enum

Find the existing enum and append `BET_PLACEMENT` and `BET_REFUND` to the bottom of the value list (preserving order of existing values):

```prisma
enum LedgerEntryType {
  DEPOSIT_CREDIT
  WITHDRAWAL_DEBIT
  WITHDRAWAL_REVERSAL
  ESCROW_LOCK
  ESCROW_RELEASE
  SETTLEMENT_PAYOUT
  FEE_COLLECTION
  ADMIN_ADJUSTMENT
  BET_PLACEMENT      // new — phase 2
  BET_REFUND         // new — phase 2
}
```

`SETTLEMENT_PAYOUT` and `FEE_COLLECTION` already exist; reuse them as-is.

#### 2b — New enums

```prisma
enum PoolStatus {
  DRAFT
  OPEN
  CLOSED
  SETTLEMENT_PENDING
  SETTLED
  REFUNDED
  CANCELLED
}

enum PoolSide {
  A
  B
}

enum PoolWinningSide {
  A
  B
  VOID
}

enum SettlementStatus {
  SCHEDULED
  DISPUTED_HOLD
  PAID_OUT
  FAILED
  REFUNDED_INSTEAD
}
```

#### 2c — `Pool` model

```prisma
model Pool {
  id                String           @id @default(uuid())
  createdByUserId   String           @map("created_by_user_id")
  title             String
  description       String?
  sideALabel        String           @map("side_a_label")
  sideBLabel        String           @map("side_b_label")
  bettingClosesAt   DateTime         @map("betting_closes_at")
  settlementDelayHours Int           @default(24) @map("settlement_delay_hours")
  status            PoolStatus       @default(DRAFT)
  creatorFeeBps     Int              @default(100) @map("creator_fee_bps")
  totalPotUnits     BigInt           @default(0) @map("total_pot_units")
  totalSideAUnits   BigInt           @default(0) @map("total_side_a_units")
  totalSideBUnits   BigInt           @default(0) @map("total_side_b_units")
  winningSide       PoolWinningSide? @map("winning_side")
  declaredAt        DateTime?        @map("declared_at")
  settledAt         DateTime?        @map("settled_at")
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedAt         DateTime         @updatedAt @map("updated_at")

  creator       User           @relation("PoolCreator", fields: [createdByUserId], references: [id])
  entries       PoolEntry[]
  disputes      DisputeLog[]
  settlementJob SettlementJob?

  @@index([status], map: "idx_pools_status")
  @@index([bettingClosesAt], map: "idx_pools_betting_closes_at")
  @@index([createdByUserId, createdAt], map: "idx_pools_creator_created")
  @@map("pools")
}
```

`settlementDelayHours` is per-pool, clamped at API layer between `SETTLEMENT_DELAY_MIN_HOURS` and `..._MAX_HOURS`. Stored explicitly so historical pools do not drift if the env var changes later.

#### 2d — `PoolEntry` model

```prisma
model PoolEntry {
  id          String   @id @default(uuid())
  poolId      String   @map("pool_id")
  userId      String   @map("user_id")
  side        PoolSide
  amountUnits BigInt   @map("amount_units")
  ledgerTxId  String?  @map("ledger_tx_id")
  createdAt   DateTime @default(now()) @map("created_at")

  pool Pool @relation(fields: [poolId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([poolId, userId], map: "uq_pool_entries_pool_user")
  @@index([poolId, side], map: "idx_pool_entries_pool_side")
  @@index([userId, createdAt], map: "idx_pool_entries_user_created")
  @@map("pool_entries")
}
```

#### 2e — `DisputeLog` model

```prisma
model DisputeLog {
  id        String   @id @default(uuid())
  poolId    String   @map("pool_id")
  userId    String   @map("user_id")
  reason    String
  createdAt DateTime @default(now()) @map("created_at")

  pool Pool @relation(fields: [poolId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@index([poolId, createdAt], map: "idx_dispute_logs_pool_created")
  @@index([userId, createdAt], map: "idx_dispute_logs_user_created")
  @@map("dispute_logs")
}
```

#### 2f — `SettlementJob` model

```prisma
model SettlementJob {
  id             String           @id @default(uuid())
  poolId         String           @unique @map("pool_id")
  declaredWinner PoolWinningSide  @map("declared_winner")
  declaredAt     DateTime         @map("declared_at")
  scheduledFor   DateTime         @map("scheduled_for")
  executedAt     DateTime?        @map("executed_at")
  status         SettlementStatus @default(SCHEDULED)
  failReason     String?          @map("fail_reason")

  pool Pool @relation(fields: [poolId], references: [id])

  @@index([status, scheduledFor], map: "idx_settlement_jobs_status_scheduled")
  @@map("settlement_jobs")
}
```

#### 2g — Add inverse relations on `User`

The existing `User` model has `deposits` and `withdrawals` arrays. Add three more relation arrays so Prisma generates the back-references:

```prisma
model User {
  // ... existing fields ...

  // existing relations:
  financialAccount FinancialAccount? @relation("UserFinancialAccount")
  deposits         Deposit[]
  withdrawals      Withdrawal[]

  // NEW (phase 2):
  poolsCreated     Pool[]            @relation("PoolCreator")
  poolEntries      PoolEntry[]
  disputeLogs      DisputeLog[]
}
```

**Validation:** schema parses (`pnpm prisma validate`). Do not run `migrate dev` yet — Step 4 does that with `--create-only`.

---

### Step 3 — Postgres trigger SQL (held until Step 5)

Save this snippet to a scratch file or your clipboard. It is appended to the migration in Step 5, not added to `schema.prisma` directly (Prisma has no native trigger DSL).

```sql
-- =====================================================================
-- Phase 2 invariant: creator-cannot-bet (ADR-0002 mitigation 1).
-- A user who creates a pool MUST NOT have a PoolEntry in that pool.
-- Enforced via BEFORE INSERT/UPDATE trigger because Postgres CHECK with
-- subqueries is only validated row-by-row, not on cross-row UPDATE.
-- =====================================================================

CREATE OR REPLACE FUNCTION enforce_creator_cannot_bet()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pools
    WHERE id = NEW.pool_id
      AND created_by_user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION
      'creator-cannot-bet: user_id % is the creator of pool_id % (ADR-0002 mitigation 1)',
      NEW.user_id, NEW.pool_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_creator_cannot_bet
  BEFORE INSERT OR UPDATE OF user_id, pool_id ON pool_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_creator_cannot_bet();
```

Notes for future-self:
- Trigger fires on `INSERT` and on `UPDATE` of `user_id` or `pool_id` only — not on every column update (cheaper).
- Error code `check_violation` (Postgres class `23`) maps cleanly to a Prisma error and lets the API layer pattern-match.
- The error message embeds both ids so logs are diagnosable without a join.

---

### Step 4 — Generate migration (without applying)

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
pnpm prisma migrate dev --name add_pool_schema --create-only
```

This produces a directory `prisma/migrations/<timestamp>_add_pool_schema/` containing `migration.sql` with the Prisma-generated DDL (CREATE TABLE for the 4 new tables, ALTER TYPE for `LedgerEntryType`, CREATE TYPE for the 4 new enums, indexes, FKs).

**Validation:** the migration directory exists and `migration.sql` is non-empty.

---

### Step 5 — Append the trigger to the migration

Open `prisma/migrations/<timestamp>_add_pool_schema/migration.sql` in your editor. **Append** (do not replace) the SQL block from Step 3 to the end of the file. The combined migration runs Prisma DDL first, then creates the trigger after `pool_entries` exists.

Verify with grep:

```powershell
Select-String -Path "prisma\migrations\*add_pool_schema\migration.sql" -Pattern "trg_creator_cannot_bet"
```

Expect 1 match.

---

### Step 6 — Apply migration + regenerate client

```powershell
pnpm prisma migrate dev      # no --name flag — applies pending migration
pnpm prisma generate         # may auto-run as part of migrate dev; run again if separate
```

If `prisma generate` standalone crashes with `0xC0000005` access violation on this Windows box, the auto-generate inside `migrate dev` already ran successfully — verify with `Test-Path node_modules\.prisma\client\index.d.ts`. (See `feedback_stale_next_types_crash_tsc.md` memory and the workaround in PROMPT_07.)

**Validation:**
- `pnpm typecheck` — exit 0 (`Pool`, `PoolEntry`, `DisputeLog`, `SettlementJob` types now reachable from `@prisma/client`).
- Direct DB sanity: `pnpm prisma studio` and confirm the four tables + the trigger function exist (Studio shows tables; for the trigger, use `psql` or any GUI: `\df enforce_creator_cannot_bet` should list it).

---

### Step 7 — `prisma/seed.ts` — no changes required

Pools are user-created at runtime, not seeded. The seed file's existing two upserts (`treasury`, `external` + 3 circuit breakers) are sufficient. If you ran `pnpm prisma db seed` after migrate, it should re-upsert idempotently and exit clean.

---

### Step 8 — Schema invariant test

Create `src/__tests__/financial/pool-escrow-invariant.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SUFFIX = `pool-schema-${Date.now()}`;

async function makeUser(suffix: string) {
  return prisma.user.create({
    data: { privyId: `wd-${suffix}-${Math.random()}` },
  });
}

async function makePool(creatorId: string) {
  return prisma.pool.create({
    data: {
      createdByUserId: creatorId,
      title: `test pool ${SUFFIX}`,
      sideALabel: "A",
      sideBLabel: "B",
      bettingClosesAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: "OPEN",
    },
  });
}

describe("pool schema invariants", () => {
  beforeEach(async () => {
    // Order matters: child rows before parents (FK).
    await prisma.poolEntry.deleteMany({});
    await prisma.disputeLog.deleteMany({});
    await prisma.settlementJob.deleteMany({});
    await prisma.pool.deleteMany({});
    // We do not delete users created here because other test files share
    // the User table; we use unique privyIds via SUFFIX so no collision.
  });

  afterAll(async () => {
    await prisma.poolEntry.deleteMany({});
    await prisma.disputeLog.deleteMany({});
    await prisma.settlementJob.deleteMany({});
    await prisma.pool.deleteMany({});
    // Clean up the test users we created (privyId starts with "wd-pool-schema-...")
    await prisma.user.deleteMany({ where: { privyId: { startsWith: `wd-pool-schema-` } } });
    await prisma.$disconnect();
  });

  it("creator-cannot-bet trigger blocks INSERT where user_id == pool.created_by_user_id", async () => {
    const creator = await makeUser("creator-1");
    const pool = await makePool(creator.id);

    await expect(
      prisma.poolEntry.create({
        data: {
          poolId: pool.id,
          userId: creator.id,
          side: "A",
          amountUnits: 1_000_000n,
        },
      }),
    ).rejects.toThrow(/creator-cannot-bet|check_violation/i);

    expect(await prisma.poolEntry.count({ where: { poolId: pool.id } })).toBe(0);
  });

  it("non-creator can place a PoolEntry", async () => {
    const creator = await makeUser("creator-2");
    const bettor = await makeUser("bettor-2");
    const pool = await makePool(creator.id);

    const entry = await prisma.poolEntry.create({
      data: {
        poolId: pool.id,
        userId: bettor.id,
        side: "A",
        amountUnits: 5_000_000n,
      },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.amountUnits).toBe(5_000_000n);
  });

  it("UNIQUE(poolId, userId) blocks duplicate bet by same user", async () => {
    const creator = await makeUser("creator-3");
    const bettor = await makeUser("bettor-3");
    const pool = await makePool(creator.id);

    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: bettor.id, side: "A", amountUnits: 1_000_000n },
    });

    await expect(
      prisma.poolEntry.create({
        data: { poolId: pool.id, userId: bettor.id, side: "B", amountUnits: 2_000_000n },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("SettlementJob.poolId UNIQUE prevents double-settle on same pool", async () => {
    const creator = await makeUser("creator-4");
    const pool = await makePool(creator.id);
    const now = new Date();
    const later = new Date(now.getTime() + 24 * 3600 * 1000);

    await prisma.settlementJob.create({
      data: {
        poolId: pool.id,
        declaredWinner: "A",
        declaredAt: now,
        scheduledFor: later,
      },
    });

    await expect(
      prisma.settlementJob.create({
        data: {
          poolId: pool.id,
          declaredWinner: "B",
          declaredAt: now,
          scheduledFor: later,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("denormalized side totals are recon-detectable when drifted from truth source", async () => {
    const creator = await makeUser("creator-5");
    const b1 = await makeUser("bettor-5a");
    const b2 = await makeUser("bettor-5b");
    const b3 = await makeUser("bettor-5c");
    const pool = await makePool(creator.id);

    // Three entries: 2 on A (1 USDC each), 1 on B (1 USDC).
    // Mirrors what the placeBet service in PROMPT_10 will do —
    // insert entry + atomically update denormalized totals.
    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: b1.id, side: "A", amountUnits: 1_000_000n },
    });
    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: b2.id, side: "A", amountUnits: 1_000_000n },
    });
    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: b3.id, side: "B", amountUnits: 1_000_000n },
    });
    await prisma.pool.update({
      where: { id: pool.id },
      data: {
        totalPotUnits: 3_000_000n,
        totalSideAUnits: 2_000_000n,
        totalSideBUnits: 1_000_000n,
      },
    });

    // Sanity: totals reflect entries before we corrupt anything.
    const before = await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } });
    expect(before.totalSideAUnits).toBe(2_000_000n);
    expect(before.totalSideBUnits).toBe(1_000_000n);

    // Inject drift: directly mutate the denormalized total.
    // This simulates whatever bug or race condition might cause the cached
    // total to diverge from the entries — the exact failure mode the recon
    // engine (PROMPT_13) must catch.
    await prisma.pool.update({
      where: { id: pool.id },
      data: { totalSideAUnits: 99_999_999n },
    });

    // Recon-style detection: aggregate from the truth source via raw SQL.
    const rows = await prisma.$queryRaw<{ sum: bigint | null }[]>`
      SELECT COALESCE(SUM(amount_units), 0)::bigint AS sum
      FROM pool_entries
      WHERE pool_id = ${pool.id} AND side = 'A'
    `;
    const aggregateA = rows[0]?.sum ?? 0n;

    const after = await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } });

    // Detection MUST work: aggregate stays anchored to entries; stored
    // value drifted; the two are now distinguishable.
    expect(aggregateA).toBe(2_000_000n);
    expect(after.totalSideAUnits).toBe(99_999_999n);
    expect(aggregateA).not.toBe(after.totalSideAUnits);
  });
});
```

The 5 tests cover:
1. Trigger blocks creator self-entry — the ADR-0002 mitigation 1 invariant
2. Non-creator can enter (positive control — trigger isn't over-blocking)
3. Duplicate bet by same user → Prisma `P2002` (unique constraint)
4. Double-settle attempt → Prisma `P2002` on `settlement_jobs.pool_id`
5. Denormalized side totals are recon-detectable when drifted from truth source — proves the recon engine (PROMPT_13) can catch a corrupt `totalSideXUnits` by comparing against `SUM(PoolEntry.amountUnits)` via raw SQL aggregate. The schema accepts the drift; the recon mechanism flags it. This is the design that justifies keeping the denormalized columns at all.

Note: tests for status-transition rules (e.g. "can't set winningSide on a DRAFT pool") are **deliberately not** in this prompt — those are application-layer invariants enforced by the lifecycle service (PROMPT_09) and tested there. The schema permits any combination; the service forbids the invalid ones.

---

### Step 9 — Verify

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
Remove-Item .next -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item tsconfig.tsbuildinfo -Force -ErrorAction SilentlyContinue

pnpm typecheck     # exit 0
pnpm test          # 52 passed (47 + 5 new)
```

If `pnpm typecheck` crashes with `0xC0000005` after adding new files: clear `.next/` (memory: `feedback_stale_next_types_crash_tsc.md`) and retry. If `vitest` crashes with the same code: it's the V8 worker flake — retry once.

---

### Step 10 — Commit

```powershell
$msg = @'
feat(pool): schema + creator-cannot-bet trigger + invariant tests (PROMPT_08)

Phase 2 data layer additions only. No services, routes, or UI yet.

Schema (prisma/schema.prisma):
- 4 new models: Pool, PoolEntry, DisputeLog, SettlementJob
- 4 new enums: PoolStatus, PoolSide, PoolWinningSide, SettlementStatus
- LedgerEntryType extended: BET_PLACEMENT, BET_REFUND
  (SETTLEMENT_PAYOUT and FEE_COLLECTION reused from phase 1)
- Pool reuses existing AccountType.BET_ESCROW (no new account type)
- Inverse relations added to User: poolsCreated, poolEntries, disputeLogs

Migration (add_pool_schema):
- Prisma-generated DDL (CREATE TABLE / ENUM / INDEX / FK)
- Hand-appended Postgres trigger trg_creator_cannot_bet:
  BEFORE INSERT OR UPDATE OF user_id, pool_id ON pool_entries
  Enforces ADR-0002 mitigation 1 at DB level.
  Reason for trigger over CHECK: subquery CHECK is only row-validated
  in PG; UPDATE on the pools table can change created_by_user_id
  and silently break the invariant.

Env (src/lib/env.ts):
- 8 new vars, all .optional() with defaults:
  POOL_MIN_BET_USDC, POOL_PLATFORM_FEE_BPS,
  POOL_CREATOR_FEE_BPS_MIN/MAX,
  SETTLEMENT_DELAY_MIN/MAX_HOURS,
  CREATOR_DECLARE_GRACE_HOURS,
  POOL_DISPUTE_HOLD_THRESHOLD_PCT
- vitest.config.ts: mocks for all 8

Tests (52 passing, +5 from previous):
- src/__tests__/financial/pool-escrow-invariant.test.ts:
  1. trigger blocks creator self-entry (INVARIANT: ADR-0002 mit-1)
  2. non-creator entry succeeds (positive control)
  3. UNIQUE(poolId, userId) blocks duplicate bet -> P2002
  4. SettlementJob.poolId UNIQUE blocks double-settle -> P2002
  5. denormalized side totals are recon-detectable when drifted —
     proves SUM(PoolEntry.amountUnits) vs Pool.totalSide?Units
     mismatch is observable via $queryRaw, the mechanism the
     PROMPT_13 recon engine relies on

Status-transition rules (winningSide-only-when-settled,
declaredWinner immutability) are application-layer; tested in
PROMPT_09 lifecycle module.
'@

$tmpFile = "C:\Users\rapha\zentrix-commit-msg.tmp"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($tmpFile, $msg, $utf8NoBom)

git add -A
git commit -F $tmpFile
Remove-Item $tmpFile -Force
git log --oneline -5
git push
```

## ── END PROMPT ──

---

## Post-flight

```powershell
# 1. New tables present
"=== expected 4 new tables ==="
pnpm prisma db execute --stdin <<< "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('pools','pool_entries','dispute_logs','settlement_jobs') ORDER BY tablename;"
# Expect 4 rows.

# 2. Trigger exists
"=== expected 1 trigger ==="
pnpm prisma db execute --stdin <<< "SELECT trigger_name FROM information_schema.triggers WHERE trigger_name='trg_creator_cannot_bet';"
# Expect 1 row.

# 3. Function exists
pnpm prisma db execute --stdin <<< "SELECT proname FROM pg_proc WHERE proname='enforce_creator_cannot_bet';"
# Expect 1 row.

# 4. New enum values
pnpm prisma db execute --stdin <<< "SELECT enumlabel FROM pg_enum WHERE enumtypid='\"LedgerEntryType\"'::regtype ORDER BY enumlabel;"
# Expect: BET_PLACEMENT, BET_REFUND, plus the 8 existing values.

# 5. Test count
pnpm test 2>&1 | Select-String "Tests" | Select-Object -First 1
# Expect: "Tests  52 passed (52)".

# 6. CI-blocking invariant present
test -f src/__tests__/financial/pool-escrow-invariant.test.ts && echo "+ pool invariant test"
```

Verwacht: alle ✓ regels printen, 52/52 groen, geen schema drift.

## Wat dit prompt niet doet

- Geen `createPool` service — komt in PROMPT_09
- Geen pool escrow-account creatie helper (analoog aan `getUserAccount`) — komt in PROMPT_09
- Geen status-transitie validatie (DRAFT → OPEN, etc.) — komt in PROMPT_09 lifecycle
- Geen `placeBet` flow — komt in PROMPT_10
- Geen API routes — komen in PROMPT_11/12
- Geen settlement engine — komt in PROMPT_13
- Geen dispute-volume check — komt in PROMPT_14
- Geen UI — komt in PROMPT_16
- Geen `BET_FEE_COLLECTION` enum value — voor MVP herbruiken we `FEE_COLLECTION`. Toevoegen wanneer analytics-filtering op pool-fees wel waardevol blijkt.

## Volgende stap

`PROMPT_09_pool_lifecycle.md` — `createPool`, `publishPool` (DRAFT→OPEN met escrow account creatie), `cancelPool` (alleen als 0 entries), `closePool` (cron transition OPEN→CLOSED op `bettingClosesAt`). Met de eerste status-transitie tests.
