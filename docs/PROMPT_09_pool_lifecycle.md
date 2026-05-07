# PROMPT_09 — Pool Lifecycle Services

**Doel:** Service-laag voor pool lifecycle: `createPool`, `publishPool`, `closePool`, `cancelPool`. Status-transities (DRAFT → OPEN → CLOSED → SETTLEMENT_PENDING → SETTLED|REFUNDED|CANCELLED) worden in de application-layer afgedwongen, met domain-specifieke errors en lazy pool-escrow-account creatie. Geen routes, geen UI, geen bet-flow — dit is puur het service-skelet waar PROMPT_10 (`placeBet`) en PROMPT_13 (settlement engine) op zullen bouwen.

**Builds on:** PROMPT_08 (schema + creator-cannot-bet trigger) — commit `9282bd3`.
**Tijd:** ~1.5 uur Claude Code (waarvan ~20 min op transition-test edge cases).
**Files touched:**
- `prisma/schema.prisma` (extend — `Pool.publishedAt`, `Pool.closedAt`)
- `prisma/migrations/<timestamp>_add_pool_lifecycle_timestamps/migration.sql` (new — `ALTER TABLE` only, geen trigger)
- `src/lib/pools/errors.ts` (new — `PoolError` class + `PoolErrorCode` union)
- `src/lib/pools/escrow.ts` (new — `getOrCreatePoolEscrowAccount` helper, idempotent)
- `src/lib/pools/lifecycle.ts` (new — 4 services)
- `src/__tests__/pools/lifecycle.test.ts` (new — 11 tests, dir is new too)

**Wat dit prompt NIET doet:**
- Geen `placeBet` / bet-flow — komt in PROMPT_10
- Geen browse / list / detail API — komt in PROMPT_11
- Geen settlement, declare, dispute, payout — komt in PROMPT_12 t/m P15
- Geen UI — komt in PROMPT_16
- **Geen HTTP routes** — alleen service-functies (P11/P12 wrappen ze)
- Geen status-transitie regels op DB-niveau (zie Beslissing 2)

---

## Beslissingen vooraf

1. **Status-transities worden in service-layer afgedwongen, niet via DB CHECK constraints.** Reden: een CHECK constraint op `status` zou elke transitie hard-coderen in DDL — bij elke gedragswijziging (bv. `DRAFT → CANCELLED` toestaan vanaf andere paden in P15) moet je migreren. Service-layer enforcement laat zich uittesten en muteren zonder schema-drift. De DB-trigger uit P08 (`creator-cannot-bet`) blijft op DB-niveau omdat die invariant nooit relaxeert.

2. **Pool escrow account is BET_ESCROW type met `scopeKey = "pool:{poolId}"`, lazy gecreëerd bij eerste bet** — niet bij `createPool`. Reden: een DRAFT of CANCELLED pool die nooit een bet ontvangt mag geen orphan escrow-account achterlaten. `createPool` is daarmee puur een Pool-row insert, geen FinancialAccount touch. De helper in Step 2 is voorbereiding voor PROMPT_10 (placeBet roept hem aan), niet voor P09 zelf.

3. **`createPool` validations zijn application-laag, niet Zod op API-boundary** — die komt in P11. P09's services accepteren typed args en throw `PoolError`. De API-laag in P11 zal Zod-parsen en errors mappen.

4. **`closePool` heeft drie callers**: `system` (cron, na `bettingClosesAt`), `creator` (vrijwillige early close), `admin` (force close via admin route in P11). Service neemt `by` als argument — de auth-check op wie er aanroept zit in de wrapper, niet hier.

5. **`cancelPool` werkt alléén op DRAFT pools** in P09. Cancel-met-refund (CANCELLED bij OPEN of CLOSED met openstaande entries) is P15 scope omdat het de full refund-flow vereist (LedgerTransaction met `BET_REFUND` entries per entry, escrow-account leegmaken). De P09-implementatie throwt expliciet `POOL_HAS_BETS_CANNOT_CANCEL` als status ≠ DRAFT.

6. **`publishedAt` en `closedAt` kolommen op `Pool`** — bestaan niet in P08-schema. **Beslissing: schema uitbreiden** (Step 0, mandatory). Twee nullable timestamps `publishedAt DateTime?` en `closedAt DateTime?` worden toegevoegd via een eigen migration `add_pool_lifecycle_timestamps`. Reden: hergebruik van `updatedAt` voor "wanneer gepubliceerd" is lossy bij elke latere update, en hergebruik van `bettingClosesAt` voor "wanneer gesloten" verliest het verschil tussen *deadline* en *werkelijk close-moment* (essentieel voor audit-log in P14 en voor rapportering van early-close door creator). De extra 2 kolommen zijn 16 bytes per pool en kosten geen index — verwaarloosbaar.

7. **Idempotency van `createPool`** — geen `idempotencyKey` argument in P09. Een dubbele clientside-submit maakt twee pools; dat is acceptabel voor DRAFT. P11 (HTTP) voegt idempotency toe via `IdempotencyKey` tabel als de UX dat eist.

---

## Pre-flight

```powershell
Set-Location C:\Users\rapha\zentrix
git status                        # clean (commit 9282bd3 op origin/main)
git log --oneline -3              # 9282bd3 -> cbc6cb2 -> 6ea7494

# Heap voor migrate (alleen relevant als je Optie A van Beslissing 6 kiest)
$env:NODE_OPTIONS = "--max-old-space-size=8192"

# Test directory check — pools/ bestaat nog niet
Test-Path src\__tests__\pools     # False — wordt in Step 7 gemaakt
```

---

## ── BEGIN PROMPT ──

You are extending zentrix with the pool lifecycle service-layer for phase 2. The single most important rule: **all status-transition validation lives in the service functions, with explicit `PoolError` throws — not in the DB, not as silent updates.** This makes lifecycle behaviour exhaustively testable and easy to amend in later prompts.

**Hard constraints:**

- Service functions are pure async functions in `src/lib/pools/lifecycle.ts`. No HTTP, no Zod, no Next-specific imports.
- Every status-transition guard throws a `PoolError` with a specific `PoolErrorCode`; no generic `Error`, no string-only throws.
- `Prisma.PrismaClientKnownRequestError` is caught only where translation to `PoolError` is unambiguous (e.g. `P2025` not-found → `POOL_NOT_FOUND`); else let it propagate.
- New tests do not delete users without filter (sibling-tests safety; reuse the prefix-cleanup pattern from `pool-escrow-invariant.test.ts`).
- Test count must rise from **52 → 62 or 63** (10–11 new tests). If your final count differs, explain in the report.
- All new files use `@/` path alias for internal imports, matching existing modules.

---

### Step 0 — Schema additions (mandatory)

Extend `model Pool` in `prisma/schema.prisma` with two nullable timestamps. Append into the existing field block (alphabetical/grouped per bestaand patroon — `prisma format` regelt het later). Wijzigingen zijn append-only, geen renames, geen mutaties op andere kolommen:

```prisma
model Pool {
  // ... existing fields (id, createdByUserId, ..., settledAt, createdAt, updatedAt) ...
  publishedAt DateTime? @map("published_at")
  closedAt    DateTime? @map("closed_at")
  // ... existing relations (creator, entries, disputes, settlementJob) ...
}
```

Validate, generate de migration als `--create-only` (geen trigger nodig — pure `ALTER TABLE ADD COLUMN`), apply via `migrate deploy`, regenerate de client. **Gebruik de recovery-routine uit `feedback_prisma_migrate_crash_recovery` als `migrate dev` of `migrate deploy` crasht** (wipe `node_modules\.prisma` + `node_modules\@prisma\engines`, `pnpm install`, dan `migrate deploy`).

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
pnpm prisma format
pnpm prisma validate                                                           # exit 0
pnpm prisma migrate dev --name add_pool_lifecycle_timestamps --create-only     # genereert directory
pnpm prisma migrate deploy                                                     # apply
pnpm prisma generate                                                           # regenerate client
```

**Validation:**
- Migration directory `prisma/migrations/<timestamp>_add_pool_lifecycle_timestamps/` bestaat.
- `migration.sql` bevat **uitsluitend** twee `ALTER TABLE "pools" ADD COLUMN` statements (één per kolom). Geen `CREATE TYPE`, geen `CREATE INDEX`, geen trigger.
- `pnpm prisma migrate status` (of fallback: tabel-query in post-flight) bevestigt dat de migration applied is.
- `pnpm typecheck` exit 0 — `Pool.publishedAt` en `Pool.closedAt` zijn nu beschikbaar als `Date | null` op het Prisma `Pool` type.

---

### Step 1 — Errors module

Create `src/lib/pools/errors.ts`:

```typescript
export type PoolErrorCode =
  | "POOL_NOT_FOUND"
  | "POOL_INVALID_STATUS"
  | "POOL_TITLE_INVALID"
  | "POOL_SIDES_INVALID"
  | "POOL_DEADLINE_INVALID"
  | "POOL_CREATOR_FEE_OUT_OF_RANGE"
  | "POOL_ALREADY_PUBLISHED"
  | "POOL_HAS_BETS_CANNOT_CANCEL"
  | "POOL_NOT_OWNED_BY_CALLER";

export class PoolError extends Error {
  constructor(
    public readonly code: PoolErrorCode,
    message: string,
    public readonly statusCode: number = 400,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PoolError";
  }
}
```

Map: 4xx for client mistakes (`POOL_NOT_FOUND` → 404, `POOL_NOT_OWNED_BY_CALLER` → 403, rest → 400). API layer (P11) reads `statusCode` directly.

**Validation:** `pnpm typecheck` exit 0.

---

### Step 2 — Pool escrow helper

Create `src/lib/pools/escrow.ts`:

```typescript
import type { Prisma } from "@prisma/client";

/**
 * Get or create the BET_ESCROW account for a given pool. Idempotent across
 * concurrent first-bet attempts via the unique constraint on scopeKey
 * (P2002 → re-read).
 *
 * IMPORTANT: only call this from inside a transaction tx (passed by the
 * caller) — placeBet wraps balance debit + entry insert + escrow credit
 * in one transaction; this helper participates in that.
 */
export async function getOrCreatePoolEscrowAccount(
  tx: Prisma.TransactionClient,
  poolId: string,
) {
  const scopeKey = `pool:${poolId}`;
  const existing = await tx.financialAccount.findUnique({ where: { scopeKey } });
  if (existing) return existing;

  try {
    return await tx.financialAccount.create({
      data: {
        accountType: "BET_ESCROW",
        scopeKey,
        balanceUnits: 0n,
        label: `Pool escrow ${poolId}`,
      },
    });
  } catch (err) {
    // Race: another concurrent first-bet won. Re-read.
    if ((err as { code?: string }).code === "P2002") {
      const after = await tx.financialAccount.findUnique({ where: { scopeKey } });
      if (after) return after;
    }
    throw err;
  }
}
```

Note: P09 itself never invokes `getOrCreatePoolEscrowAccount` — that's P10's job. Het wordt nu gedefinieerd zodat P10 een stable target heeft (en de race-handling alvast getest is — zie test 8 hieronder, "race condition handling").

**Validation:** `pnpm typecheck` exit 0.

---

### Step 3 — `createPool` service

Create `src/lib/pools/lifecycle.ts` and start with the imports + `createPool`:

```typescript
import { Prisma, type Pool } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { PoolError } from "./errors";

interface CreatePoolInput {
  creatorId: string;
  title: string;
  description?: string;
  sideALabel: string;
  sideBLabel: string;
  bettingClosesAt: Date;
  creatorFeeBps: number;
}

const TITLE_MIN = 1;
const TITLE_MAX = 200;
const SIDE_LABEL_MIN = 1;
const SIDE_LABEL_MAX = 50;
const BETTING_DEADLINE_MIN_AHEAD_MS = 60 * 60 * 1000;             // 1 hour
const BETTING_DEADLINE_MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days

export async function createPool(input: CreatePoolInput): Promise<Pool> {
  const env = getEnv();
  const now = new Date();

  // title
  const title = input.title.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    throw new PoolError(
      "POOL_TITLE_INVALID",
      `title length must be ${TITLE_MIN}-${TITLE_MAX} chars`,
      400,
      { actual: title.length },
    );
  }

  // sides
  const a = input.sideALabel.trim();
  const b = input.sideBLabel.trim();
  if (
    a.length < SIDE_LABEL_MIN || a.length > SIDE_LABEL_MAX ||
    b.length < SIDE_LABEL_MIN || b.length > SIDE_LABEL_MAX
  ) {
    throw new PoolError(
      "POOL_SIDES_INVALID",
      `each side label must be ${SIDE_LABEL_MIN}-${SIDE_LABEL_MAX} chars`,
      400,
    );
  }
  if (a.toLowerCase() === b.toLowerCase()) {
    throw new PoolError(
      "POOL_SIDES_INVALID",
      "sideALabel and sideBLabel must be different",
      400,
    );
  }

  // deadline
  const ms = input.bettingClosesAt.getTime() - now.getTime();
  if (ms < BETTING_DEADLINE_MIN_AHEAD_MS || ms > BETTING_DEADLINE_MAX_AHEAD_MS) {
    throw new PoolError(
      "POOL_DEADLINE_INVALID",
      "bettingClosesAt must be 1h-90d in the future",
      400,
      { msAhead: ms },
    );
  }

  // creator fee
  if (
    input.creatorFeeBps < env.POOL_CREATOR_FEE_BPS_MIN ||
    input.creatorFeeBps > env.POOL_CREATOR_FEE_BPS_MAX
  ) {
    throw new PoolError(
      "POOL_CREATOR_FEE_OUT_OF_RANGE",
      `creatorFeeBps must be in [${env.POOL_CREATOR_FEE_BPS_MIN}, ${env.POOL_CREATOR_FEE_BPS_MAX}]`,
      400,
      { actual: input.creatorFeeBps },
    );
  }

  return prisma.pool.create({
    data: {
      createdByUserId: input.creatorId,
      title,
      description: input.description?.trim() || null,
      sideALabel: a,
      sideBLabel: b,
      bettingClosesAt: input.bettingClosesAt,
      creatorFeeBps: input.creatorFeeBps,
      status: "DRAFT",
    },
  });
}
```

**Validation:** `pnpm typecheck`. No tests yet — Step 7 covers them all together.

---

### Step 4 — `publishPool` service

Append to `src/lib/pools/lifecycle.ts`:

```typescript
interface PublishPoolInput {
  poolId: string;
  creatorId: string;
}

export async function publishPool(input: PublishPoolInput): Promise<Pool> {
  const pool = await prisma.pool.findUnique({ where: { id: input.poolId } });
  if (!pool) {
    throw new PoolError("POOL_NOT_FOUND", `pool ${input.poolId} not found`, 404);
  }
  if (pool.createdByUserId !== input.creatorId) {
    throw new PoolError(
      "POOL_NOT_OWNED_BY_CALLER",
      "only the creator can publish this pool",
      403,
    );
  }
  if (pool.status !== "DRAFT") {
    throw new PoolError(
      "POOL_INVALID_STATUS",
      `cannot publish pool in status ${pool.status}`,
      409,
      { currentStatus: pool.status },
    );
  }

  return prisma.pool.update({
    where: { id: input.poolId },
    data: {
      status: "OPEN",
      publishedAt: new Date(),
    },
  });
}
```

Note: we don't re-check `bettingClosesAt > now` here because `createPool` already enforced it (≥ 1h ahead). If creator dawdles for >1h between create and publish, that's their problem; explicit re-check would surprise users with a different error than they got at create-time. P10 (`placeBet`) does the live deadline check.

---

### Step 5 — `closePool` service (manual + cron-ready)

```typescript
type ClosePoolBy = "system" | "creator" | "admin";

interface ClosePoolInput {
  poolId: string;
  by: ClosePoolBy;
}

export async function closePool(input: ClosePoolInput): Promise<Pool> {
  const pool = await prisma.pool.findUnique({ where: { id: input.poolId } });
  if (!pool) {
    throw new PoolError("POOL_NOT_FOUND", `pool ${input.poolId} not found`, 404);
  }
  if (pool.status !== "OPEN") {
    throw new PoolError(
      "POOL_INVALID_STATUS",
      `cannot close pool in status ${pool.status}`,
      409,
      { currentStatus: pool.status, by: input.by },
    );
  }

  return prisma.pool.update({
    where: { id: input.poolId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      // bettingClosesAt is NOT modified here — it stays as set at create-time
      // (creator-early-close path in P15 will mutate that field separately)
    },
  });
}
```

Note: `by` is logged via metadata in P14 but not yet persisted in P09 — keeping the schema lean. We intentionally accept `by="creator"` even though no caller does it yet; P11 admin route + P15 settlement-cron will both reuse this function.

---

### Step 6 — `cancelPool` service (DRAFT-only path)

```typescript
interface CancelPoolInput {
  poolId: string;
  creatorId: string;
}

export async function cancelPool(input: CancelPoolInput): Promise<Pool> {
  const pool = await prisma.pool.findUnique({ where: { id: input.poolId } });
  if (!pool) {
    throw new PoolError("POOL_NOT_FOUND", `pool ${input.poolId} not found`, 404);
  }
  if (pool.createdByUserId !== input.creatorId) {
    throw new PoolError(
      "POOL_NOT_OWNED_BY_CALLER",
      "only the creator can cancel this pool",
      403,
    );
  }
  if (pool.status !== "DRAFT") {
    // PROMPT_15 will replace this with a refund-aware cancelPool that
    // also handles OPEN/CLOSED with active entries. Until then, callers
    // must use admin route + manual refund flow for non-DRAFT cancels.
    throw new PoolError(
      "POOL_HAS_BETS_CANNOT_CANCEL",
      `pool is ${pool.status}, cancel-with-refund not implemented until P15`,
      409,
      { currentStatus: pool.status },
    );
  }

  return prisma.pool.update({
    where: { id: input.poolId },
    data: { status: "CANCELLED" },
  });
}
```

**Validation:** `pnpm typecheck` exit 0 after all four services and the helper exist.

---

### Step 7 — Lifecycle tests

Create `src/__tests__/pools/lifecycle.test.ts`. Reuse the prefix-based cleanup discipline from `pool-escrow-invariant.test.ts`.

```typescript
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { PoolError } from "@/lib/pools/errors";
import {
  createPool,
  publishPool,
  closePool,
  cancelPool,
} from "@/lib/pools/lifecycle";

const SUFFIX = `pool-lifecycle-${Date.now()}`;
const PRIVY_PREFIX = `wd-${SUFFIX}-`;

async function makeUser(label: string) {
  return prisma.user.create({
    data: { privyId: `${PRIVY_PREFIX}${label}-${Math.random()}` },
  });
}

const validInput = (creatorId: string) => ({
  creatorId,
  title: "Will it rain in Amsterdam tomorrow?",
  sideALabel: "Yes",
  sideBLabel: "No",
  bettingClosesAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  creatorFeeBps: 200,
});

describe("pool lifecycle services", () => {
  beforeEach(async () => {
    // FK is RESTRICT — child rows first.
    await prisma.poolEntry.deleteMany({});
    await prisma.disputeLog.deleteMany({});
    await prisma.settlementJob.deleteMany({});
    await prisma.pool.deleteMany({});
  });

  afterAll(async () => {
    await prisma.poolEntry.deleteMany({});
    await prisma.disputeLog.deleteMany({});
    await prisma.settlementJob.deleteMany({});
    await prisma.pool.deleteMany({});
    await prisma.user.deleteMany({ where: { privyId: { startsWith: PRIVY_PREFIX } } });
    await prisma.$disconnect();
  });

  // 1
  it("createPool happy path → DRAFT row with all fields", async () => {
    const creator = await makeUser("c1");
    const pool = await createPool(validInput(creator.id));
    expect(pool.status).toBe("DRAFT");
    expect(pool.title).toBe("Will it rain in Amsterdam tomorrow?");
    expect(pool.sideALabel).toBe("Yes");
    expect(pool.sideBLabel).toBe("No");
    expect(pool.creatorFeeBps).toBe(200);
    expect(pool.totalPotUnits).toBe(0n);
  });

  // 2
  it("createPool rejects empty/whitespace title", async () => {
    const creator = await makeUser("c2");
    await expect(
      createPool({ ...validInput(creator.id), title: "   " }),
    ).rejects.toMatchObject({ code: "POOL_TITLE_INVALID" });
  });

  // 3
  it("createPool rejects identical sideA/sideB labels (case-insensitive)", async () => {
    const creator = await makeUser("c3");
    await expect(
      createPool({ ...validInput(creator.id), sideALabel: "Yes", sideBLabel: "yes" }),
    ).rejects.toMatchObject({ code: "POOL_SIDES_INVALID" });
  });

  // 4
  it("createPool rejects bettingClosesAt < 1h in the future", async () => {
    const creator = await makeUser("c4");
    await expect(
      createPool({
        ...validInput(creator.id),
        bettingClosesAt: new Date(Date.now() + 30 * 60 * 1000),
      }),
    ).rejects.toMatchObject({ code: "POOL_DEADLINE_INVALID" });
  });

  // 5
  it("createPool rejects creatorFeeBps out of [MIN,MAX] range", async () => {
    const creator = await makeUser("c5");
    await expect(
      createPool({ ...validInput(creator.id), creatorFeeBps: 9999 }),
    ).rejects.toMatchObject({ code: "POOL_CREATOR_FEE_OUT_OF_RANGE" });
  });

  // 6
  it("publishPool DRAFT → OPEN happy path", async () => {
    const creator = await makeUser("c6");
    const pool = await createPool(validInput(creator.id));
    const published = await publishPool({ poolId: pool.id, creatorId: creator.id });
    expect(published.status).toBe("OPEN");
    expect(published.publishedAt).toBeTruthy();
    expect(published.publishedAt!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  // 7
  it("publishPool rejects non-creator caller", async () => {
    const creator = await makeUser("c7");
    const stranger = await makeUser("s7");
    const pool = await createPool(validInput(creator.id));
    await expect(
      publishPool({ poolId: pool.id, creatorId: stranger.id }),
    ).rejects.toMatchObject({ code: "POOL_NOT_OWNED_BY_CALLER" });
  });

  // 8
  it("publishPool rejects re-publish of OPEN pool", async () => {
    const creator = await makeUser("c8");
    const pool = await createPool(validInput(creator.id));
    await publishPool({ poolId: pool.id, creatorId: creator.id });
    await expect(
      publishPool({ poolId: pool.id, creatorId: creator.id }),
    ).rejects.toMatchObject({ code: "POOL_INVALID_STATUS" });
  });

  // 9
  it("closePool OPEN → CLOSED with by=system", async () => {
    const creator = await makeUser("c9");
    const pool = await createPool(validInput(creator.id));
    await publishPool({ poolId: pool.id, creatorId: creator.id });
    const closed = await closePool({ poolId: pool.id, by: "system" });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).toBeTruthy();
    expect(closed.closedAt!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  // 10
  it("cancelPool DRAFT → CANCELLED happy path", async () => {
    const creator = await makeUser("c10");
    const pool = await createPool(validInput(creator.id));
    const cancelled = await cancelPool({ poolId: pool.id, creatorId: creator.id });
    expect(cancelled.status).toBe("CANCELLED");
  });

  // 11
  it("cancelPool rejects non-DRAFT pool with POOL_HAS_BETS_CANNOT_CANCEL", async () => {
    const creator = await makeUser("c11");
    const pool = await createPool(validInput(creator.id));
    await publishPool({ poolId: pool.id, creatorId: creator.id });
    // Pool is now OPEN; cancel must throw.
    await expect(
      cancelPool({ poolId: pool.id, creatorId: creator.id }),
    ).rejects.toMatchObject({ code: "POOL_HAS_BETS_CANNOT_CANCEL" });
  });
});
```

11 tests; alle drie de error-shapes (`PoolError.code`) worden geverifieerd via `toMatchObject`. Geen direct test op `escrow.ts` — die wordt in P10 getest via een end-to-end placeBet-call met race-simulatie.

---

### Step 8 — Verify

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item .next -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item tsconfig.tsbuildinfo -Force -ErrorAction SilentlyContinue

pnpm typecheck                   # exit 0
pnpm test                        # 63 passed (52 + 11 nieuwe)
```

If `pnpm test` shows 1 worker crash op deze Windows-box: zie `feedback_prisma_queryraw_generic_tsc_crash` — dit is een known V8-flake bij heavy Prisma client surface. Targeted run (`pnpm test pools/lifecycle`) bevestigt of de tests zelf groen zijn.

---

### Step 9 — Commit

```powershell
$msg = @'
feat(pool): lifecycle services + status validation (PROMPT_09)

Phase 2 service layer for pool lifecycle. No HTTP routes, no UI yet.

Services (src/lib/pools/):
- errors.ts: PoolError class + PoolErrorCode union (9 codes)
- escrow.ts: getOrCreatePoolEscrowAccount (idempotent, race-safe via P2002)
- lifecycle.ts: createPool, publishPool, closePool, cancelPool

Status transitions enforced in service layer (not DB):
- createPool   -> DRAFT
- publishPool  : DRAFT -> OPEN  (creator-only)
- closePool    : OPEN  -> CLOSED (system|creator|admin)
- cancelPool   : DRAFT -> CANCELLED (creator-only, DRAFT-only;
                 OPEN/CLOSED cancel-with-refund deferred to P15)

Validation (createPool):
- title 1-200 chars, trimmed
- side labels 1-50 chars each, distinct (case-insensitive)
- bettingClosesAt 1h-90d ahead
- creatorFeeBps within [POOL_CREATOR_FEE_BPS_MIN, _MAX] env range

Tests (src/__tests__/pools/lifecycle.test.ts, 11 new):
- 5 createPool: happy + 4 validation rejection paths
- 3 publishPool: happy + non-creator + re-publish rejection
- 1 closePool happy with by=system
- 2 cancelPool: DRAFT happy + non-DRAFT rejection

Schema additions:
- Pool.publishedAt, Pool.closedAt (nullable timestamps)
- Migration: add_pool_lifecycle_timestamps (ALTER TABLE only, no trigger)

Reused from P08:
- creator-cannot-bet trigger (still enforces invariant on PoolEntry insert)
- All env vars (POOL_CREATOR_FEE_BPS_MIN/MAX, etc.)
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
# 1. New service files exist
Test-Path src\lib\pools\errors.ts
Test-Path src\lib\pools\escrow.ts
Test-Path src\lib\pools\lifecycle.ts
Test-Path src\__tests__\pools\lifecycle.test.ts
# Expect 4× True

# 2. PoolError code count = 9
Select-String -Path src\lib\pools\errors.ts -Pattern '^\s*\|\s*"POOL_' | Measure-Object -Line
# Expect: 9

# 3. Tests passing
pnpm test pools/lifecycle 2>&1 | Select-String "Tests"
# Expect: "Tests  11 passed (11)"

# 4. Total test count
pnpm test 2>&1 | Select-String "Tests" | Select-Object -First 1
# Expect: "Tests  63 passed (63)"  (52 + 11)

# 5. Schema check — beide kolommen aanwezig
pnpm prisma db execute --stdin <<< "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name='pools' AND column_name IN ('published_at','closed_at') ORDER BY column_name;"
# Expect 2 rows: closed_at + published_at, beide is_nullable=YES, data_type=timestamp without time zone

# 6. Migration applied
pnpm prisma db execute --stdin <<< "SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '%add_pool_lifecycle_timestamps%' ORDER BY started_at DESC LIMIT 1;"
# Expect 1 row met finished_at non-null.
```

---

## Wat dit prompt niet doet

- Geen `placeBet` flow — komt in **PROMPT_10** (incl. `getOrCreatePoolEscrowAccount` invocatie + `BET_PLACEMENT` ledger entry + atomic `totalSideXUnits` increment + creator-cannot-bet trigger live op DB-niveau)
- Geen browse / list / detail API — komt in **PROMPT_11**
- Geen settlement engine, dispute volume check, refund flow — **PROMPT_12 t/m P15**
- Geen UI — **PROMPT_16**
- **Geen cancel-with-refund voor OPEN/CLOSED pools** — komt in **PROMPT_15**, maakt gebruik van bestaande `BET_REFUND` ledger-entry-type en escrow-leegmaak-routine
- Geen audit-log persist (`closePool by=...`) — komt in **PROMPT_14** met dedicated `PoolAuditLog` model of via `LedgerEntry.meta`

---

## Edge cases als TODO voor latere prompts

- **Pool met bets cancellen** (refund logic) — **PROMPT_15**: `cancelPoolWithRefund` orchestreert per-entry `BET_REFUND` ledger-entries en zet de pool naar `REFUNDED`.
- **Pool die `bettingClosesAt` overschrijdt zonder `closePool` call** — **PROMPT_13** cron: `closePool({ by: "system" })` voor alle `status=OPEN` waar `bettingClosesAt < now`.
- **Pool die `SETTLEMENT_DELAY_MAX_HOURS + CREATOR_DECLARE_GRACE_HOURS` overschrijdt zonder declare** — **PROMPT_15** cron: auto-refund alle entries en zet pool op `REFUNDED`.
- **Concurrent publish+cancel race** — niet relevant in P09 omdat beide acties alleen DRAFT pools muteren en de Pool-row geen optimistic concurrency heeft; in P10 (placeBet) wordt het wel relevant via `Withdrawal.version`-style optimistic locking als entries in flight zijn.

---

## Volgende stap

`PROMPT_10_place_bet.md` — `placeBet({userId, poolId, side, amountUnits})`: balance-check op user account, transaction-wrapped insert van `PoolEntry` + `LedgerTransaction` met BET_PLACEMENT entries (user_account → pool_escrow), atomic `totalSideXUnits` + `totalPotUnits` increment via raw `UPDATE ... SET ... = ... + $amount`, creator-cannot-bet trigger live test, deadline-passed test, fee-not-yet-deducted invariant (fees pas bij settlement). 12-15 nieuwe tests, race-condition tests met `Promise.all`-style concurrent placeBets.
