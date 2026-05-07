# Phase 2 Design — Pools, Bets, Settlement

**Status:** Blueprint for PROMPT_08 through PROMPT_16
**Date:** 2026-05-07
**Owner:** Raphal Bongsomenggolo
**Builds on:** ADR-0001 (architecture), ADR-0002 (settlement model), phase 1 financial primitives (PROMPT_04 ledger, PROMPT_05 deposits, PROMPT_06 withdrawals, PROMPT_07 observability)

The purpose of this document is to lock in design decisions for phase 2 **before** code is written, so build sessions stay focused on implementation rather than re-architecting per prompt. If this document doesn't answer a question, raise it; don't paper over it during a build prompt.

---

## 1. Scope & out-of-scope

**In scope (phase 2):**

- Pool creation by any authenticated user (creator role is per-pool, not platform-level)
- Two-sided pools only (`A` vs `B`)
- Multi-bet per pool (one entry per user per pool); arbitrary number of users per side
- Settlement model from ADR-0002: creator declares winner → 24–48h delay → cron pays out
- Public dispute log (no economic effect; reputation signal only)
- Refund mechanic: empty side at settlement, creator-no-declare grace expiration, admin abort
- Basic UI: create pool, browse open pools, place bet, view my entries, declare winner, dispute
- Platform fee + creator fee at settlement, dust handling explicit

**Out of scope (defer to phase 3 or later):**

- Oracle settlement (per-pool option, ADR-0002 review trigger)
- Arbiter marketplace / paid third-party referees
- KYC, geo-fencing, sanctions screening
- Mobile app (web-responsive only in phase 2)
- Advanced reputation scoring (numeric trust score, badges, etc.)
- Multi-side pools (>2 outcomes)
- Pool privacy modes (invite-only, password-protected)
- Pool media (images, videos)
- Anti-money-laundering controls beyond a configurable per-bet cap

---

## 2. Schema overview

All money fields are `BigInt` micro-USDC (consistent with phase 1 R4). Foreign keys use cascading rules sparingly — favor explicit cleanup in code over silent cascade-deletes.

### `Pool`

```prisma
model Pool {
  id                    String           @id @default(uuid())
  createdByUserId       String           @map("created_by_user_id")
  title                 String
  description           String?
  sideALabel            String           @map("side_a_label")
  sideBLabel            String           @map("side_b_label")
  bettingClosesAt       DateTime         @map("betting_closes_at")    // last moment a bet can be placed
  status                PoolStatus       @default(DRAFT)
  creatorFeeBps         Int              @default(100) @map("creator_fee_bps")  // 1% default; clamped at validation
  totalPotUnits         BigInt           @default(0) @map("total_pot_units")
  totalSideAUnits       BigInt           @default(0) @map("total_side_a_units")  // denormalized; updated atomically with bet
  totalSideBUnits       BigInt           @default(0) @map("total_side_b_units")  // denormalized; updated atomically with bet
  winningSide           PoolWinningSide? @map("winning_side")          // null until declared
  declaredAt            DateTime?        @map("declared_at")
  settledAt             DateTime?        @map("settled_at")
  createdAt             DateTime         @default(now()) @map("created_at")
  updatedAt             DateTime         @updatedAt @map("updated_at")

  creator       User           @relation("PoolCreator", fields: [createdByUserId], references: [id])
  entries       PoolEntry[]
  disputes      DisputeLog[]
  settlementJob SettlementJob?

  @@index([status])
  @@index([bettingClosesAt])
  @@index([createdByUserId, createdAt], map: "idx_pools_creator_created")
  @@map("pools")
}
```

**Notes:**
- `totalPotUnits`, `totalSideAUnits`, `totalSideBUnits` are denormalized. The truth source is the sum of `PoolEntry.amountUnits` per side. Update them atomically inside the same `prisma.$transaction` as the entry insert. Recon test should verify they match the aggregate (analogous to `FinancialAccount.balanceUnits` invariant in phase 1).
- `bettingClosesAt` named explicitly to avoid the confusion of "deadline" (deadline for what?). The grace period for creator declaration is computed from this field plus `CREATOR_DECLARE_GRACE_HOURS`.
- No foreign key from `Pool.createdByUserId` directly enforces "user exists at create time" — onDelete behavior is restrictive by default; user deletion is not a flow we currently support.

### `PoolEntry` (the bet)

```prisma
model PoolEntry {
  id          String   @id @default(uuid())
  poolId      String   @map("pool_id")
  userId      String   @map("user_id")
  side        PoolSide
  amountUnits BigInt   @map("amount_units")
  ledgerTxId  String?  @map("ledger_tx_id")  // FK to LedgerTransaction; null only during the brief in-tx window
  createdAt   DateTime @default(now()) @map("created_at")

  pool Pool @relation(fields: [poolId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([poolId, userId], map: "uq_pool_entries_pool_user")  // one entry per user per pool — see edge case 7
  @@index([poolId, side], map: "idx_pool_entries_pool_side")     // for per-side aggregates at settlement
  @@index([userId, createdAt], map: "idx_pool_entries_user_created")
  @@map("pool_entries")
}
```

**Notes:**
- **DB-level enforcement of the `creator-cannot-bet` rule** (ADR-0002 mitigation 1) is a CHECK constraint added via raw migration SQL, not natively in Prisma. The constraint:
  ```sql
  ALTER TABLE pool_entries
    ADD CONSTRAINT pool_entries_creator_not_entrant_check
    CHECK (
      user_id <> (SELECT created_by_user_id FROM pools WHERE id = pool_id)
    );
  ```
  Note: this is a **subquery in CHECK** which Postgres only enforces row-by-row. For stronger guarantees use a trigger that runs on INSERT/UPDATE. Prefer the trigger; document the choice in PROMPT_08.
- `side` typed `PoolSide` (A or B only). VOID winners cannot have entries — the entry side enum has only two values.

### `DisputeLog`

```prisma
model DisputeLog {
  id        String   @id @default(uuid())
  poolId    String   @map("pool_id")
  userId    String   @map("user_id")
  reason    String                                                // free text, validated max length at API layer
  createdAt DateTime @default(now()) @map("created_at")

  pool Pool @relation(fields: [poolId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@index([poolId, createdAt], map: "idx_dispute_logs_pool_created")
  @@index([userId, createdAt], map: "idx_dispute_logs_user_created")  // for surfacing on creator profile via join
  @@map("dispute_logs")
}
```

**Notes:**
- Application layer enforces "only entrants of a pool can dispute" — there is no DB-level constraint for this; it is a permission check, not a data invariant.
- No `status` field. Disputes are append-only and immutable. Resolution (if any) is via the pool's status transitions, not via dispute mutations.
- Aggregating disputes for the "high dispute volume" check in settlement is a `COUNT(DISTINCT user_id)` over this table per pool.

### `SettlementJob`

```prisma
model SettlementJob {
  id             String           @id @default(uuid())
  poolId         String           @unique @map("pool_id")  // exactly one settlement attempt per pool
  declaredWinner PoolWinningSide  @map("declared_winner")
  declaredAt     DateTime         @map("declared_at")
  scheduledFor   DateTime         @map("scheduled_for")    // declaredAt + delay
  executedAt     DateTime?        @map("executed_at")
  status         SettlementStatus @default(SCHEDULED)
  failReason     String?          @map("fail_reason")

  pool Pool @relation(fields: [poolId], references: [id])

  @@index([status, scheduledFor], map: "idx_settlement_jobs_status_scheduled")  // cron worker query
  @@map("settlement_jobs")
}
```

**Notes:**
- `poolId @unique` enforces "one settlement attempt per pool, ever." No replays. If the first attempt fails, the row stays at status=`FAILED` and operator intervention is required.
- `declaredWinner` is immutable once the row is created — see edge case 3.

### Enums

```prisma
enum PoolStatus {
  DRAFT                // creator working on it; not visible to others
  OPEN                 // accepting bets
  CLOSED               // bets closed (bettingClosesAt passed); awaiting creator declaration
  SETTLEMENT_PENDING   // creator declared; SettlementJob exists; delay running
  SETTLED              // payouts executed
  REFUNDED             // refunded (lege side / auto-refund / admin / creator declared VOID)
  CANCELLED            // cancelled before any bet was placed
}

enum PoolSide {
  A
  B
}

enum PoolWinningSide {
  A
  B
  VOID                 // creator explicitly says no winner; triggers refund path
}

enum SettlementStatus {
  SCHEDULED            // waiting for scheduledFor; not yet picked up by cron
  DISPUTED_HOLD        // dispute threshold exceeded; cron is skipping; admin must resolve
  PAID_OUT             // executed successfully
  FAILED               // execution failed; failReason populated; admin intervention required
  REFUNDED_INSTEAD     // declared, but at execution time we routed to refund (e.g. lege winning side)
}
```

---

## 3. Pool status flow

```
DRAFT
  │
  │ creator publishes
  ▼
OPEN
  │
  │ bettingClosesAt passes (cron)              ┌───────────────────────────────┐
  ▼                                            │ creator-no-declare-grace cron │
CLOSED ─────────────────────────────────────► REFUNDED (auto-refund)
  │                                            │ — declared no winner in time
  │ creator declares                           │ — admin force-refund
  │ winner (creates SettlementJob)             │ — VOID winner declared
  ▼                                            │ — empty winning side at exec time
SETTLEMENT_PENDING ────────────────────────────┘
  │
  │ scheduledFor passes; settlement cron runs
  │ no high-dispute hold
  ▼
SETTLED
```

**Plus the dead-end branch:**
```
DRAFT  ──► CANCELLED   (creator deletes before any bet)
OPEN   ──► CANCELLED   (creator deletes; only allowed if 0 entries — operator may
                        force-cancel with bets, which converts to REFUNDED instead)
```

**State transition rules (enforced at API + cron layers):**

| From | Allowed to | By |
|-----|-----------|----|
| `DRAFT` | `OPEN`, `CANCELLED` | creator |
| `OPEN` | `CLOSED` (auto on `bettingClosesAt`) | cron |
| `OPEN` | `CANCELLED` (only if 0 entries) | creator |
| `CLOSED` | `SETTLEMENT_PENDING` (creator declares A/B) | creator |
| `CLOSED` | `REFUNDED` (creator declares VOID, or grace-expiration cron, or admin) | creator/cron/admin |
| `SETTLEMENT_PENDING` | `SETTLED` | settlement cron |
| `SETTLEMENT_PENDING` | `REFUNDED` (lege winning side at execution) | settlement cron |
| `SETTLED`, `REFUNDED`, `CANCELLED` | (terminal) | — |

A pool **never** moves backward. There is no "unsettlement," no "uncancel."

---

## 4. Money flow

### 4.1 Pool escrow account

Each pool gets a dedicated `FinancialAccount` of type `BET_ESCROW`. Creation timing: at the moment of `Pool.status` transitioning to `OPEN`, not at `DRAFT`. A draft pool has no escrow.

```ts
// Created via getOrCreatePoolEscrowAccount(tx, poolId):
{
  accountType: "BET_ESCROW",
  scopeKey: betScopeKey(poolId),  // "bet:<poolId>"
  userId: null,
  balanceUnits: 0n,
}
```

### 4.2 Bet placement (user → pool)

Atomic in one `prisma.$transaction`:

1. `lockAccount(tx, userAccount.id)` — FOR UPDATE on the user's account
2. Verify `pool.status === "OPEN"` and `now < pool.bettingClosesAt`
3. Verify `pool.createdByUserId !== input.userId` (defense in depth; DB trigger is the authority)
4. Verify `amountUnits >= POOL_MIN_BET_UNITS`
5. Verify `userAccount.balanceUnits >= amountUnits`
6. `lockAccount(tx, poolEscrowAccount.id)` — FOR UPDATE on pool escrow
7. `recordTransaction({ lines: [{ debit: userAccount, credit: poolEscrow, amount: amountUnits, type: "BET_PLACEMENT" }] })`
8. `INSERT PoolEntry { poolId, userId, side, amountUnits, ledgerTxId }`
9. `UPDATE Pool SET totalPotUnits += amountUnits, totalSide${side}Units += amountUnits`

`UNIQUE(poolId, userId)` on `PoolEntry` makes step 8 fail with P2002 if the user already has an entry → API returns 409 (edge case 7).

### 4.3 Settlement payout (winning side X)

Atomic in one `prisma.$transaction`. Pre-execution checks happen outside the transaction (cheap DB reads).

```
Inputs:
  totalPot       = pool.totalPotUnits
  sumWinning     = pool.totalSide${X}Units
  sumLosing      = pool.totalSide${Y}Units
  platformFeeBps = POOL_PLATFORM_FEE_BPS              // e.g. 200 = 2%
  creatorFeeBps  = pool.creatorFeeBps                 // 100..500 = 1..5%

Compute:
  platformFee  = applyBps(totalPot, platformFeeBps)
  creatorFee   = applyBps(totalPot, creatorFeeBps)
  distributable = totalPot - platformFee - creatorFee

For each PoolEntry e on side X:
  share[e] = (e.amountUnits * distributable) / sumWinning      // BigInt floor division

remainder = distributable - sum(share[e])                        // floor-division dust, ≥ 0
```

Ledger lines (one transaction, idempotency key `pool-settlement:<poolId>`):

| Line | Debit account | Credit account | Amount | EntryType |
|------|---------------|----------------|--------|-----------|
| Per winning entry e | pool_escrow | user_account[e.userId] | share[e] | `SETTLEMENT_PAYOUT` |
| Platform fee | pool_escrow | treasury | platformFee + remainder | `FEE_COLLECTION` |
| Creator fee | pool_escrow | user_account[pool.createdByUserId] | creatorFee | `FEE_COLLECTION` |

After the transaction, `pool_escrow.balanceUnits` MUST be `0n`. The recon engine should verify this for all pools in `SETTLED` status (analogous to phase 1 ledger invariants).

**Dust policy:** the floor-division remainder is added to the **platform fee** line (not distributed to a "lucky" winner, not lost). Cleanest accounting; dust → treasury, not random users.

**Update pool:** `status = SETTLED`, `winningSide = X`, `settledAt = now`. Update `SettlementJob` row: `status = PAID_OUT`, `executedAt = now`.

### 4.4 Refund (REFUNDED — empty side, VOID, no-declare grace, admin)

Atomic in one `prisma.$transaction`. No fees.

For each `PoolEntry`:
- `recordTransaction({ lines: [{ debit: pool_escrow, credit: user_account, amount: entry.amountUnits, type: "BET_REFUND" }] })`
- Idempotency key `pool-refund:<poolId>:<entryId>` so partial-refund retries are safe

After all refunds: `pool_escrow.balanceUnits` MUST be `0n`. `Pool.status = REFUNDED`. `SettlementJob.status = REFUNDED_INSTEAD` (if a job existed).

---

## 5. Edge cases (with concrete answers)

### 5.1 Empty side at settlement
**Scenario:** Creator declares `A`, but `pool.totalSideAUnits === 0n` (no one bet on A).

**Answer:** Settlement cron detects this at execution time. Routes to **refund path** instead of payout. `SettlementJob.status = REFUNDED_INSTEAD`. `Pool.status = REFUNDED`. No fees collected. All entries refunded full amount.

### 5.2 Creator never declares
**Scenario:** Pool reaches `CLOSED` and stays there. Creator vanishes.

**Answer:** A cron (`pool-grace-expiration`) runs every hour and finds pools where `status = CLOSED` AND `now > bettingClosesAt + CREATOR_DECLARE_GRACE_HOURS`. Refunds them. Marks the creator's profile with a `creator_no_declare_count` increment for surfacing in their public profile (analogous to the dispute log's reputation signal).

`CREATOR_DECLARE_GRACE_HOURS` env var, default `168` (7 days).

### 5.3 Creator wants to change winner during delay
**Scenario:** Creator declares `A`, then realizes they meant `B` an hour later.

**Answer:** **NOT ALLOWED.** Once `SettlementJob` is created, `declaredWinner` is immutable. The API does not expose an "update winner" endpoint. The creator can only contact the operator, who can `tripCircuit("settlement")` to pause the cron and either let it expire (creator must dispute publicly via the `DisputeLog` like any user) or — in the rare admin-justified case — manually amend via direct DB write with audit trail. This must be exceptional, not a workflow.

### 5.4 High dispute volume
**Scenario:** Creator declares `A`. Within the delay window, `>= POOL_DISPUTE_HOLD_THRESHOLD_PCT` (default 50) of unique entrants post a `DisputeLog` entry against this settlement.

**Answer:** Settlement cron, before payout, computes `disputeRatio = COUNT(DISTINCT DisputeLog.userId WHERE poolId=X) / COUNT(DISTINCT PoolEntry.userId WHERE poolId=X)`. If `>= threshold`: `SettlementJob.status = DISPUTED_HOLD`. Pool stays `SETTLEMENT_PENDING`. Operator must manually resolve by either (a) settling anyway via admin route, (b) refunding via admin route, or (c) closing the breaker after investigation.

### 5.5 Creator declares non-existent side
**Scenario:** Someone hits the API with `winner=C`.

**Answer:** Schema-level: `PoolWinningSide` enum is `A | B | VOID`. A `C` value cannot reach the database. API zod-validation rejects with 400 before hitting the DB.

### 5.6 Pool with one bet (no opposing side)
**Scenario:** Pool created, only one entry (on side A), `bettingClosesAt` passes.

**Answer:** Same path as 5.1 (empty side at settlement). When creator declares (any value), settlement cron sees `totalSideBUnits === 0n` and routes to refund. The lone entrant gets their full amount back. No fees.

The `creator-cannot-bet` rule (ADR-0002 mitigation 1) means a "1-entry" pool has 1 real entrant + 0 creator-entrants — this scenario is structurally common in poorly-promoted pools, not an exotic edge case. Refund-without-fee is the right answer to avoid penalizing creators for low traction.

### 5.7 Duplicate bet by same user
**Scenario:** User has an entry on side A, tries to add another bet (different side or same side, same or different amount).

**Answer:** `UNIQUE(poolId, userId)` on `PoolEntry` makes the second `INSERT` fail with Prisma error code P2002. API catches and returns **409 Conflict** with `{error: "ALREADY_ENTERED", message: "You already have an entry in this pool"}`. There is no "increase your bet" flow in v1.

---

## 6. Money economics

| Parameter | Default | Env var | Notes |
|-----------|---------|---------|-------|
| Min bet per entry | 1 USDC | `POOL_MIN_BET_USDC` | string-decimal, parsed via `parseUsdc` |
| Max bet per entry per pool | (unlimited) | `POOL_MAX_BET_USDC` | optional; TBD threshold tied to AML in fase 3 |
| Platform fee | 2% (200 bps) | `POOL_PLATFORM_FEE_BPS` | int, range 0–1000 |
| Creator fee — min | 1% (100 bps) | `POOL_CREATOR_FEE_BPS_MIN` | enforced at pool creation |
| Creator fee — max | 5% (500 bps) | `POOL_CREATOR_FEE_BPS_MAX` | enforced at pool creation |
| Settlement delay — min | 24h | `SETTLEMENT_DELAY_MIN_HOURS` | per ADR-0002 mitigation 2 |
| Settlement delay — max | 48h | `SETTLEMENT_DELAY_MAX_HOURS` | per ADR-0002 mitigation 2 |
| Creator-no-declare grace | 168h (7 days) | `CREATOR_DECLARE_GRACE_HOURS` | edge case 5.2 |
| Dispute hold threshold | 50% | `POOL_DISPUTE_HOLD_THRESHOLD_PCT` | edge case 5.4 |
| Min entries per pool | (none) | — | a pool can settle with 1 entry → refund (5.6) |
| Max entries per pool | (none) | — | per-user limit is 1 by uniqueness |

All economic env vars must be `.optional()` in the zod schema with sensible defaults so existing tests don't break.

---

## 7. PROMPT-by-PROMPT plan (P08–P16)

Every prompt follows the phase 1 template: pre-flight, hard constraints, numbered steps, post-flight, "what this prompt does NOT do." Each prompt builds on its predecessors and includes tests as the last numbered step before commit.

### PROMPT_08 — Pool/PoolEntry/DisputeLog/SettlementJob schema + migration
**Scope:** Schema additions only. The four models, three new enums (`PoolStatus`, `PoolSide`, `PoolWinningSide`, `SettlementStatus`), one new `LedgerEntryType` value (`BET_PLACEMENT`, `SETTLEMENT_PAYOUT`, `BET_REFUND` already exist as candidates — verify and amend the enum), CHECK trigger for creator-cannot-bet.
**Dependencies:** none beyond phase 1.
**Tests:** smoke — schema accepts rows, unique constraint catches duplicates, trigger blocks creator entries, refusal of `Pool.status` invalid transitions via raw SQL.
**Files:** `prisma/schema.prisma`, migration directory, `prisma/seed.ts` (no seed data needed).

### PROMPT_09 — Pool creation + lifecycle module
**Scope:** `src/lib/pools/create.ts` (`createPool`, validates fee bounds + delay bounds), `src/lib/pools/lifecycle.ts` (`publishPool` DRAFT→OPEN, `cancelPool`, `closePool` cron transition OPEN→CLOSED). Pool escrow `FinancialAccount` is created at publish time (`getOrCreatePoolEscrowAccount`).
**Dependencies:** PROMPT_08.
**Tests:** create rejects invalid fee, creates DRAFT, publish creates escrow + transitions to OPEN, cancel only allowed with 0 entries.

### PROMPT_10 — Bet placement (R7-equivalent for pools)
**Scope:** `src/lib/pools/bet.ts` (`placeBet`), `POST /api/pools/[id]/entries`. Validation order analogous to withdrawal intake: kill-switch → pool-status → amount → balance → atomic ledger debit + entry insert + denormalized total update. UNIQUE conflict → 409.
**Dependencies:** PROMPT_09.
**Tests:** happy path, duplicate → 409, creator self-bet → 403 + DB trigger as backstop, balance insufficient, pool not OPEN, amount below min, all in chaos-matrix style for concurrency.

### PROMPT_11 — Pool browsing/reading API
**Scope:** `GET /api/pools` (list with filters: status, my-entries, creator), `GET /api/pools/[id]` (single + aggregates: total per side, my entry, recent disputes), pagination via cursor.
**Dependencies:** PROMPT_10.
**Tests:** filtering, pagination, my-entries flag, redaction of unfinished pools (DRAFT only visible to creator).

### PROMPT_12 — Settlement declaration
**Scope:** `POST /api/pools/[id]/declare-winner` (creator-only, body `{winner: A|B|VOID}`). Creates `SettlementJob` row with `scheduledFor = now + clamp(pool.settlementDelayHours, MIN, MAX)`. Pool transitions CLOSED→SETTLEMENT_PENDING (or directly to REFUNDED if VOID). `declaredWinner` immutable.
**Dependencies:** PROMPT_11.
**Tests:** non-creator → 403, status not CLOSED → 409, double-declare → 409 (UNIQUE on settlement_jobs.poolId), VOID path goes to refund cron.

### PROMPT_13 — Settlement execution cron + payout engine
**Scope:** `src/lib/pools/settlement.ts` (`executePendingSettlement`, `payoutWinners`, `refundAll`), `GET /api/cron/execute-settlements` (every 5 min). Dispute threshold check, lege-side detection, dust-to-treasury policy. Idempotency keys per ledger transaction.
**Dependencies:** PROMPT_12.
**Tests:** payout math correctness (BigInt floor + dust accounting), dispute hold, lege side → refund, idempotency on retry, recon-equivalent invariant test (`pool_escrow.balanceUnits === 0n` post-settlement).

### PROMPT_14 — Dispute log
**Scope:** `POST /api/pools/[id]/disputes`, `GET /api/pools/[id]/disputes`, surfaced on creator profile. Only entrants of the pool can dispute. Append-only.
**Dependencies:** PROMPT_13 (so SettlementJob exists when disputes are posted).
**Tests:** non-entrant → 403, double-dispute by same user → allowed (multiple entries OK; the ratio counts unique users), reason length validation.

### PROMPT_15 — Auto-refund cron + admin abort route
**Scope:** `GET /api/cron/pool-grace-expiration` (every hour) — finds pools past `bettingClosesAt + CREATOR_DECLARE_GRACE_HOURS` in CLOSED status, refunds them. `POST /api/admin/pools/[id]/abort` — admin force-cancel/refund (uses `requireAdmin()`).
**Dependencies:** PROMPT_13.
**Tests:** grace-expiration edge cases (exact boundary, time zone), admin abort during SETTLEMENT_PENDING, refund idempotency.

### PROMPT_16 — UI for pool create / browse / bet / dispute
**Scope:** Server Components for pool list + detail, Client Components for the action forms (create pool, place bet, declare winner, file dispute), basic styling (Tailwind, consistent with phase 1 dashboard). No design system required — functional and responsive.
**Dependencies:** PROMPT_15 (full backend complete).
**Tests:** none mandatory beyond manual smoke. Optional: Playwright/Vitest browser test for the create→bet→settle happy path.

---

## 8. Testing strategy

### 8.1 Unit tests
- `src/lib/pools/fee.ts` — fee math (platform + creator clamp, dust accounting)
- `src/lib/pools/share.ts` — winner share calculation (BigInt floor; remainder = distributable - sum(shares))
- Status transition validators (table-driven: every (from, to) pair tested)

### 8.2 Integration tests
Full lifecycle in one test file, one per scenario:
- `pool-happy-path.test.ts` — create, publish, 4 bets (2 per side), close, declare A, advance time past delay, run settlement, verify balances + ledger
- `pool-refund-empty-side.test.ts` — bets only on side A, declare A, settlement detects empty side B, refunds all
- `pool-refund-grace-expiration.test.ts` — bets placed, close, no declaration, grace expires, cron refunds
- `pool-dispute-hold.test.ts` — declare, multiple disputes pushing past threshold, settlement skips, admin resolves

### 8.3 Concurrency / chaos tests
- 10 parallel `placeBet` calls on same pool by same user → exactly one succeeds (UNIQUE catches the rest, all 9 return 409)
- 10 parallel `placeBet` by 10 different users on same pool → all 10 succeed, totals match
- 10 parallel calls to `executePendingSettlement` for same pool → exactly one succeeds (idempotency key on the ledger transaction)

### 8.4 Settlement engine tests
- Delay enforcement: `scheduledFor` strictly in the future means cron skips
- Dust correctness: pool with 7 winners and 3 USDC distributable → sum(shares) + remainder = 3 USDC exactly
- Recon invariant (CI-blocking): every pool in `SETTLED` or `REFUNDED` status has `pool_escrow.balanceUnits === 0n`

### 8.5 Schema invariants (extension of phase 1 trio)
A new file `src/__tests__/financial/pool-escrow-invariant.test.ts` joining the existing three CI-blocking tests:
- For every `Pool` in terminal status, `BET_ESCROW.balanceUnits === 0n`
- For every `PoolEntry`, `ledgerTxId` references a valid `LedgerTransaction`
- `Pool.totalPotUnits === SUM(PoolEntry.amountUnits)` per pool, and per-side denormalizations match aggregate

---

## 9. Open questions / TBD

These are explicitly not answered in this document. Each must be resolved before the relevant prompt or with a separate ADR.

1. **Max bet per pool per user** — currently unlimited. AML/KYC concerns push for a cap; product wants flexibility. Likely env-var with default `null` (unlimited) and operator override. Decide before PROMPT_10.
2. **Refund fees** — currently zero in all refund paths. Question: is there a case for charging a small "creator-no-declare" penalty against the creator (deducted from creator fee on next pool, or platform absorbs)? Not in v1; revisit if creator-no-declare becomes common.
3. **Creator blacklist** — no protocol-level mechanism in phase 2. If a creator accumulates disputes or no-declare count past some threshold, their pools could be hidden by default in the listing API. Soft-launch reputation feature; specify in fase 3.
4. **Pool privacy modes** — public-only in phase 2. Invite-only / passworded pools deferred to fase 3.
5. **Multi-side pools** — phase 2 is binary only. The schema (`PoolSide` enum, `totalSideAUnits` / `totalSideBUnits` columns) hardcodes this. A migration to N-sided pools is non-trivial; deferred to phase 3 with a proper `PoolOption` table.
6. **VOID-with-bets-on-both-sides** — the simplest interpretation: declare VOID → refund everyone, no fees. Alternative: charge platform fee even on VOID to disincentivize creators from declaring void as a way to keep small fee revenue while disclaiming responsibility. Default to "no fees on VOID" for v1; reconsider if abused.
7. **Creator's profile page surface area** — what exactly is shown on a creator's public profile? Pool count, dispute count, no-declare count, total volume? Specify in PROMPT_11 or a follow-up.
8. **Bet amendment / withdrawal during OPEN** — can a user cancel their own bet before `bettingClosesAt`? v1 says no (bets are final once placed). If product wants this in fase 3, requires careful ledger reversal logic + creator notification.

---

## How to amend this document

- Cosmetic updates (typo fixes, clarifications): edit in place.
- Schema-shape changes that affect a prompt that has already shipped: write a follow-up ADR (`ADR-0003-...`) and reference it from this document; do not silently edit a section that contradicts shipped code.
- If an open question (Section 9) gets answered: move the answer into the relevant section and remove from Section 9 with a one-line note `(resolved YYYY-MM-DD: see Section X)`.
