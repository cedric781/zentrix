# ADR-0003 — 1v1 P2P bets with Pool as tournament container

**Status:** Accepted
**Date:** 2026-05-09
**Decision-maker:** Raphal Bongsomenggolo
**Supersedes:** [ADR-0002](./ADR-0002-settlement-model.md) — pool-creator-decides settlement on a parimutuel pool model. ADR-0002's settlement-trust mitigations (creator-cannot-bet-on-own-pool, settlement delay, public dispute log) are retained in modified form; the parimutuel pool *as a market structure* is dropped.

---

## Context

ADR-0002 committed Zentrix to a parimutuel pool model: each pool is a single market, all entries on a side share the pot proportionally, the creator declares the winning side, money flows pool-escrow → winners pro-rata. PROMPT_08 and PROMPT_09 were built against that model: `Pool.totalSideAUnits / totalSideBUnits / totalPotUnits` aggregate fields, `PoolEntry` per (user, side), pool-creator-as-resolver, single market per pool.

That market structure is wrong for the product Zentrix actually wants to ship. The platform's core unit of value is **a 1-on-1 wager between two specific users on a specific outcome** — Wager-style. Users want to challenge a friend, agree on stake, and have one winner take the (almost) full pot. They want this *both* as a stand-alone bet ("me vs. you, pick a winner") *and* as a structured ronde of bets organized by a pool creator ("I'm running a UFC card prediction round; everyone match up against each other on each fight").

The parimutuel structure does not serve either case:
- For stand-alone P2P: parimutuel collapses to N=2 entries, but the math, schema, and UI all assume "many entries on each side, pro-rata share." The 1v1 case is a degenerate sub-case of a general structure that adds no value.
- For tournament rondes: parimutuel forces "everyone in the same pot," which means a 6-person UFC card with 12 fights becomes one giant pool, not 12 distinct match-by-match wagers between specific user pairs. The product wants the latter.

Wager (https://github.com/raphalbongso/wager) shipped exactly this 1v1 P2P model and ran it for over a year. Its `Bet` + `BetParticipant` + `BetInvite` shape, accept-flow with `FOR UPDATE` row-locks, double-entry ledger keyed on deterministic strings, and HTTP-layer idempotency table all proved out in production. Wager's mistakes — dual-version schemas (V1+V3), fail-open dispute deposit lock, on-chain custody complexity layered on top of platform-custody ledger — are documented and avoidable. The Wager-pattern report from the 2026-05-08 session captures the full inventory of what to copy and what to drop.

The decision below shifts Zentrix's foundation to that 1v1 P2P model and re-introduces the Pool concept as a **container of N matches**, not a single market. PROMPT_08 and PROMPT_09 must be refactored to fit this; PROMPT_10 (placeBet for parimutuel) is invalidated and will not be executed.

---

## Decision

Zentrix's wager primitive is a **1-on-1 bet** between a creator and an opponent, with equal stakes and a single winner. Pools are an optional grouping layer on top: a Pool is a **set of matches** organized by a creator, where each match can host multiple independent 1v1 bets between different user pairs.

### 1. Bet model — 1v1 P2P fundament

A `Bet` row is the canonical wager unit and represents a single 1-on-1 contest:

- **Creator + opponent**, equal stake on opposite sides. `Bet.creatorId`, `Bet.opponentUserId` (nullable until accept), `Bet.creatorSide`, `Bet.acceptorSide`, `Bet.stakeUnits` (BigInt; pot = 2 × stake). No proportional-share math.
- **Settlement mode (MVP):** `PROOF_CONFIRM` only. ARBITER_REQUIRED, AUTO_VERIFY (oracle / sports-API), and other Wager-modes are out of scope until post-MVP and need separate ADRs if introduced.
- **Stand-alone bets exist** (`Bet.poolId` nullable). A 1v1 created without a Pool reference works exactly like a Wager-bet: creator funds, opponent accepts, both confirm a winner, settlement pays.
- **Pool-attached bets exist** (`Bet.poolId` not null, `Bet.matchId` not null). Same lifecycle, except the result is set by the pool creator's match-result submission rather than by both bettors confirming each other.
- **Multi-bet per (user, pool) is allowed.** A user can be the creator of a bet on Match 1 and the opponent on a bet for Match 3 within the same Pool. The 1v1 sluit-constraint applies per Bet, not per Pool.

**Wager patterns adopted as-is:**
- `BetParticipant` with `@@unique([betId, side])` — guarantees one user per side per bet.
- `Bet.version Int` for optimistic locking on every status mutation, paired with `updateMany({where: {id, version}})` count-check → `OPTIMISTIC_LOCK_FAILED` (409) on race.
- `SELECT id FROM bets WHERE id = $1 FOR UPDATE` at the start of every status-mutating transaction.
- `BetInvite` with token-hash + `safeHashCompare` (constant-time) for invite links.
- `BetStateTransition` audit table — every status change recorded with `event`, `actorId`, `actorType`, `metadata`.

**`BetStatus` is bounded to 10 values** for MVP PROOF_CONFIRM (Wager has 24, most for other modes):
```
DRAFT → OPEN → ACTIVE → RESULT_PROPOSED → AWAITING_CONFIRMATION → SETTLED
                     ↘                  ↘                       ↘
                      CANCELLED          DISPUTED → SETTLED|VOID  EXPIRED|VOID
```

### 2. Pool feature — tournament container

A `Pool` is a creator-organized ronde of matches. The creator is the operator, not a bettor; bettors are users who form 1v1 bets on individual matches within the pool.

- **`Pool` row:** id, creatorId, title, description, lifecycle status (DRAFT → OPEN → CLOSED → SETTLED), bettingClosesAt, createdAt. No aggregate side/pot fields — those were the parimutuel artefacts and are dropped.
- **`Match` row (new):** id, poolId, title, eventTime, status (SCHEDULED → RESULT_SUBMITTED → SETTLED|DISPUTED), `winnerSide` (set by creator), `proofText`, `proofUrl`, `proofImageUrl`, `proofVideoUrl` (all optional, all stored as evidence), `disputeWindowEndsAt`. Each Match is an independent settlement unit; one Match's dispute does not block other Matches in the same Pool.
- **`Bet.matchId` (nullable):** binds a Bet to a Match. Stand-alone bets have `matchId = null` and `poolId = null`. Pool-attached bets have both.
- **Per-match settlement flow:** pool creator submits `(winnerSide, optional proof bundle)` → `Match.status = RESULT_SUBMITTED`, `disputeWindowEndsAt = now + 24h`, `Bet.winnerId` derived for every Bet on this Match (the user whose `acceptorSide`/`creatorSide` matches `winnerSide`). 24h dispute window opens for any bettor on this Match. After expiry without dispute, all Bets on the Match transition to SETTLED and ledger settlement runs.
- **Per-match dispute:** any bettor on a Match can dispute the creator's submission within 24h. Dispute opens with the standard 10% deposit (see fees). Pool creator is the implicit counterparty for all Bets on the disputed Match — i.e., the dispute is "bettor vs. pool-creator," with the platform's admin as decider. If the bettor wins the dispute, the pool creator pays the dispute resolution fee penalty (15% of disputed pot) and the Bet is settled with the bettor's claimed winner. If the bettor loses, the original creator submission stands and the bettor's deposit is forfeited.

### 3. Fees — uniform, single-source-of-truth

A single `src/lib/fees.ts` constant module is the only source for fee numbers, mirroring Wager's pattern. No hardcoded percentages anywhere else.

| Fee | Rate | When |
|---|---|---|
| Platform fee | 2% of pot | At settlement, winner only |
| Dispute resolution fee | 15% of pot | Replaces 2% when a dispute is resolved (does **not** stack) |
| Dispute deposit | 10% of stake (min $0.50) | Opener-only, locked at dispute open |
| Withdrawal fee | 1% | At off-ramp |
| Creation fee | 0% | Never |

Per-pool fee overrides are explicitly out of scope for MVP. If pool-specific economics are needed (e.g., a long tournament wants a lower platform fee), that is a post-MVP feature and needs its own ADR.

### 4. Dispute mechanism

- **Opener-only deposit.** Only the dispute opener stores 10% (min $0.50). The counterparty does not store. This is a deliberate simplification of Wager's bilateral-but-asymmetric model, which produced inconsistent forfeit handling in `finalizeDisputeSettlement`.
- **Faal-closed deposit lock.** If the deposit-lock ledger transaction fails (insufficient balance, account error, ledger-engine error), **the dispute does not open**. The bet stays in its pre-dispute status. Wager's `dispute-service.ts:189-207` catches the error and lets the dispute proceed without collateral — this is a bug and we do not replicate it.
- **Decider:** platform admin for MVP. No arbiter marketplace, no panel decisions, no oracle-resolution. Admin reviews evidence (uploaded via `BetEvidence` with `contentHash` dedup), decides outcome (`CREATOR_WINS | OPPONENT_WINS | VOID`), records `Dispute.outcome` + `resolvedById` + `resolvedAt`.
- **Reputation-gated escalation.** Wager's `dispute-abuse-prevention` patterns are adopted: max 5 disputes per rolling 30-day window per user; reputation score 0-100 derived from dispute win-rate; <50 score blocks new disputes; 3+ lost disputes escalates the deposit rate from 10% to 20%. Implementation lives in a separate `src/lib/disputes/abuse.ts` module, sourced from `UserReputation` snapshots.
- **Pool-match disputes:** the pool creator is the de-facto counterparty for every disputed Match-result. They do not need to lock a deposit at submit-time (gating that would chill legitimate result submissions), but on losing a dispute they pay the 15% resolution fee from their account on top of the bettor receiving their deposit back. Repeated lost pool disputes feed the same reputation system.

### 5. Idempotency

Two-layer pattern, copied from Wager:

- **HTTP layer.** `IdempotencyKey { userId, key, route, statusCode, responseJson, completedAt, expiresAt }` table with `@@unique([userId, key])`. Wrapper `withIdempotency(key, opts, handler)` reserves atomically, returns cached response on replay, returns 409 `REQUEST_IN_FLIGHT` if pending. TTL 24h, swept by cron.
- **Ledger layer.** `LedgerTransaction.idempotencyKey @unique`, caller-supplied deterministic strings: `bet-hold:{betId}:{role}`, `settle:{betId}`, `refund:{betId}:{reason}`, `dispute-deposit:{betId}:{userId}`, `dispute-refund:{betId}:{userId}`, `dispute-award:{betId}:{loserId}`, `withdrawal:{withdrawalId}`. Replay returns existing transaction without re-executing.

The dispatch between layers: routes use HTTP idempotency for the entire request; the ledger engine inside the handler uses ledger idempotency for each money-movement primitive. Both are independently safe under retry.

### 6. Race conditions

Strategy is layered:

- Bet-row `FOR UPDATE` lock at start of every status-mutating tx (per Wager `bet-service.ts:472, 845`).
- `FinancialAccount` row lock via `lockAccount()` inside `recordTransaction()` for both debit and credit account, sorted by id to avoid deadlock under concurrent multi-account writes.
- Optimistic `version` field on Bet as a second-line guard.
- `getOrCreateXAccount(tx)` helpers using `findUnique → create → catch P2002 → re-findUnique` for race-safe lazy creation of escrow/treasury accounts.

There is no Pool-row lock. Pool aggregates do not exist (parimutuel sums are gone), so there is nothing to serialize at the Pool level. Match-level mutations lock the Match row when the creator submits a result.

### 7. Security baseline

Adopted from Wager:
- `import "server-only"` on every file under `src/lib/` that touches DB or money.
- Constant-time hash compare for invite tokens (`safeHashCompare`).
- Evidence dedup via sha256 `contentHash` on every uploaded proof file.
- Invariant cron (∑ all balances = 0, `isBalanced` per LedgerTransaction, per-bet escrow_in = winner_out + treasury_fee, per-user denormalized = reconstructed-from-entries).
- Circuit breaker as a hard money-movement gate; states HEALTHY → DEGRADED → QUARANTINED → HALTED → INVESTIGATING → RECOVERY, persisted in DB so it survives serverless cold starts. Tripping is automatic from invariant violations; recovery is admin-only and step-by-step.
- Hardcoded kill-switch for withdrawals (no DB-flag-only path to disable safety).

### 8. What we explicitly do not copy from Wager

- Dual-version schemas. Wager has `Dispute` (V1) **and** `SettlementDispute` (V3); `ResultClaim` (V1) **and** `BetResultClaim` (V3); `LedgerEntry` (V1) **and** `LedgerEntryV2`; `SettlementLog` **and** `SettlementLogV3`. Zentrix picks one canonical version (the V3-equivalent shape) and ships only that.
- Fail-open dispute deposit lock — see decision 4.
- 24-value `BetStatus` enum — Zentrix uses 10 (listed in decision 1). Adding a value requires an ADR.
- `Decimal(36,18)` for stakes — Zentrix uses `BigInt` units everywhere, including in the Bet model. PROMPT_08-09 already chose this representation; the refactor preserves it.
- Two-phase accept with manual rollback — Wager's accept does (a) tx for status update, (b) ledger hold in separate tx, (c) compensating rollback on (b) failure. This shape exists because Wager's ledger engine was bolted on after on-chain custody. Zentrix has no on-chain step, so accept happens in a single `prisma.$transaction`.
- `SideBet` model — out of scope.
- `AUTO_VERIFY` / `ARBITER_REQUIRED` / oracle paths — post-MVP, separate ADRs.
- The 100-field `Bet` model. Zentrix targets ~25 fields (creatorId, opponentUserId, creatorSide, acceptorSide, stakeUnits, status, winnerId, expiresAt, confirmDeadline, disputeWindowEndsAt, settledAt, cancelledAt, voidedAt, version, poolId, matchId, settlementMode, resultStatus, createdByLedgerTxId, plus 6 timestamps and audit fields). Sports/oracle/manual_review/fraud-snapshot fields belong in side tables or do not exist.

---

## Consequences

### What changes in PROMPT_08-09 (refactor needed)

PROMPT_08 (`pool_schema.md`) and PROMPT_09 (`pool_lifecycle.md`) were written against the parimutuel model. The refactor removes:

- `Pool.totalSideAUnits`, `Pool.totalSideBUnits`, `Pool.totalPotUnits` — parimutuel aggregates with no role in 1v1 bookkeeping.
- `Pool.sideALabel`, `Pool.sideBLabel`, `Pool.creatorFeeBps` — single-market parimutuel artefacts.
- `PoolEntry` table — replaced by `Bet` + `BetParticipant`. PoolEntry-as-bet collapses to two-row `BetParticipant` per Bet.
- `creator-cannot-bet` trigger on `pool_entries` — moved to a `creator-cannot-bet-on-own-match` trigger on `bets` (i.e., a Pool creator cannot be a bettor on any match within their own Pool, but can bet on other creators' Pools).
- Pool lifecycle services that mutate aggregate fields (`publishPool`, `closePool`, `cancelPool`'s parimutuel-related branches) — simplified to status transitions only.

PROMPT_10 (`place_bet.md`) is **invalidated** as written and will not be executed. Its ledger-engine patterns (FOR UPDATE on user account, fee split, idempotency-key handling, BetError class) are reusable in the new `placeBet` for 1v1; the multi-bet-per-pool-side aggregation logic and creator-cannot-bet-via-trigger-on-pool_entries are not.

A separate `docs/REFACTOR_PLAN.md` (next deliverable) will detail the unwind: which commits to revert, which to amend, migration strategy given that PROMPT_08-09 migrations are already applied to dev DB.

### What stays unchanged

- PROMPT_01-07 work: Next.js + Prisma + Privy bootstrap (P01-03), `FinancialAccount` + `LedgerTransaction` + `LedgerEntryV2` schema (P04, P07), deposit pipeline (P05), withdrawal flow with address-validation (P06), observability + recon engine (P07). All ledger-engine work is canonical and reused.
- `getOrCreatePoolEscrowAccount` race-safe helper from PROMPT_09 — generalized to `getOrCreateBetEscrowAccount(tx, betId)` (same pattern, scoped per Bet not per Pool).
- The `PoolError` class pattern from PROMPT_09 — extended with a sibling `BetError` class (one error class per bounded context).
- The prefix-cleanup test pattern (`SUFFIX + PRIVY_PREFIX`) from PROMPT_09 tests.
- ADR-0001 architecture decisions (Next.js, Prisma, Privy, Solana, monorepo structure).
- ADR-0002's three settlement-trust mitigations, modified for 1v1 + Pool: (a) Pool-creator-cannot-bet-on-own-match (DB constraint, see above), (b) 24h dispute window per Match before ledger payout, (c) public dispute log surfaced on creator's profile (`Dispute` rows with `Pool.creatorId` filter).

### What is new

- `Bet` model (1v1 P2P primitive).
- `BetParticipant`, `BetInvite`, `BetEvidence`, `BetStateTransition`, `BetParticipantConfirmation`, `BetResultClaim` tables (V3 names; one canonical version each).
- `Match` table (Pool-internal grouping).
- `Dispute` table with admin-decided outcome and 10% opener-only deposit.
- `IdempotencyKey` table (HTTP layer).
- `UserReputation` table for dispute-abuse-prevention scoring.
- `src/lib/bets/` directory: `service.ts` (create/accept/cancel/confirm/settle), `errors.ts` (`BetError` + 10-code union), `escrow.ts` (`getOrCreateBetEscrowAccount`), `idempotency.ts` (HTTP wrapper).
- `src/lib/disputes/` directory: `service.ts` (open/resolve), `abuse.ts` (rate limit + reputation + escalated deposit).
- `src/lib/fees.ts` single-source constant module.
- Prompt files PROMPT_10 onward are replaced with a new sequence keyed on the 1v1 model. Numbering preserved where the topic carries over (e.g., new PROMPT_10 = `placeBet` for 1v1) and shifted where the topic is new (e.g., `submitMatchResult`, `openDispute`, `resolveDispute`).

### Cost of this decision

Concretely: PROMPT_08-09 represent ~3 days of work (66 tests, 9 commits on `main`). The refactor will retire most of that code. The ledger and escrow primitives are salvageable; the Pool/PoolEntry domain layer is not. This is the price of correcting a wrong domain choice rather than shipping it.

### Reversibility

This decision is reversible only at high cost once the new schema is migrated and bets exist in production. Up to and during the refactor (planned in `REFACTOR_PLAN.md`), reverting back to parimutuel is cheap: no production data, dev DB can be reset. After first user bet, every reversal becomes a data-migration story.

The decision **does not** foreclose adding a parimutuel-pool feature later as a separate market type alongside 1v1 — but doing so adds genuine schema complexity, and the bar for approving it should be high.

---

## Alternatives rejected

### Strategie B — keep parimutuel pool, add 1v1 as a parallel market type

Run both market structures side-by-side: `Pool` rows continue to be parimutuel single-markets, and a new `Bet` table exists for 1v1 wagers. Pool can optionally host bets, or bets can be stand-alone, but the parimutuel pool remains a first-class concept.

Rejected because:
- Dual money-movement paths. Pool settlement (pro-rata distribution to N winners) and Bet settlement (single winner, single fee) are non-isomorphic. They would need separate ledger-engine wrappers, separate test suites, separate dispute flows. Wager's V1+V3 dual schemas are a cautionary example of what this becomes after a year.
- Marketing-and-product confusion. "Make a pool" vs. "make a bet" requires distinct user flows, distinct UI components, distinct help docs. The product pitch ("bet 1-on-1 against your friends, organized into rondes") fits 1v1+container cleanly and gets muddied by parimutuel.
- ADR-0002's settlement-trust mitigations (creator-cannot-bet, settlement delay, public dispute log) were designed around parimutuel mechanics. Carrying them forward unchanged for parimutuel while building a separate dispute system for 1v1 doubles the audit surface.

### Strategie C — rename `Pool` to `Match`, keep parimutuel mechanics

Treat each Pool row as a Match between two users by setting Pool's max entries to 2. Cosmetic refactor only — no schema change, just relabel.

Rejected because:
- The 1v1 product wants identifiable creator + opponent + invite-token + accept-flow with the opponent specifically opting in. Two-entry parimutuel has no notion of "the other side accepted" — both entries are independent. Forcing the second entry to be the "accept" loses the funding-gate, the optimistic locking, the invite-token validation, and the creator-cannot-bet semantic (creator-self-side-second-entry would be allowed by the parimutuel schema).
- Pool-as-tournament-container is genuinely a different concept from a single market. Renaming Pool to Match collapses the container layer entirely; users who want to organize a ronde of matches lose that affordance.
- The fee model (2% per win, 15% on dispute-resolved) does not map to parimutuel's pro-rata distribution math without contortions.

---

## References

- [ADR-0001](./ADR-0001-architecture.md) — foundational architecture choices (Next.js, Prisma, Privy, Solana, monorepo). Unchanged by this decision.
- [ADR-0002](./ADR-0002-settlement-model.md) — superseded by this ADR for the parimutuel pool model. Mitigations 1-3 (creator-cannot-bet, settlement delay, public dispute log) carry forward in modified form for 1v1 + Pool.
- [LESSONS_FROM_WAGER.md](./LESSONS_FROM_WAGER.md) — non-negotiable rules from the Wager post-mortem. All still apply.
- Wager-pattern report (chat session 2026-05-08) — captured in memory under `reference_wager_repo.md` and `project_zentrix.md`. Detailed inventory of which Wager files contain which patterns (bet-service, dispute-service, idempotency, ledger/engine, ledger/record, ledger/invariants, settlement/proof-settlement-service, settlement/dispute-abuse-prevention, circuit-breaker).
- Wager source: https://github.com/raphalbongso/wager (master branch). Reference implementation, not a copy-paste source.
- Next deliverable: `docs/REFACTOR_PLAN.md` — step-by-step unwind of PROMPT_08-09, schema migration strategy, commit-level revert/amend list. To be authored after this ADR is reviewed and accepted.
