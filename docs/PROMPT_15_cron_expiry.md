# P15: Cron Expiry System — Bet Lifecycle Automation

## Scope

### In
- Auto-expire OPEN bets past `expiresAt` timestamp (24h default per Wager pattern)
- Auto-void PROOF_SUBMITTED bets past `confirmDeadline` timeout (24h default per Wager pattern)
- Cleanup stale BetInvite tokens (expiresAt < now, usedAt = null)
- Cleanup stale IdempotencyKey rows (expiresAt < now, for expiry-based TTL)
- BET_EXPIRED reputation event firing (creator only, -2 delta)

### Out of scope (P15)
- Dispute auto-escalation (requires Dispute.evidencePhaseEndsAt schema — P15b)
- RESULT_PROPOSED → auto-settle without confirmation (business decision deferred)
- Admin notification system (P17+)
- Creation fee implementation (separate P18+, not P15 dependency)
- Score decay / reputation expiry

## Design Decisions (locked)

### 1. Expire Transitions & Refund Policy
**Pattern:** Wager BUSINESS_RULES.md "EXPIRED/VOID = no fee, full refund"

- **OPEN → EXPIRED** (expiresAt < now):
  - Status transition to EXPIRED
  - Ledger: debit bet escrow → credit creator account
  - entryType: ESCROW_RELEASE
  - note: bet-expire-refund:${betId}
  - idempotencyKey: bet-expire:${betId}
  - No platform fee deducted (conservative)
  - BET_EXPIRED reputation event fires for creator (-2 delta)

- **PROOF_SUBMITTED → VOID** (confirmDeadline < now):
  - Status transition to VOID
  - Ledger: debit bet escrow → split refund to creator + opponent
    - Each receives: escrow / 2 (equal split)
    - entryType: ESCROW_RELEASE for both
    - note: bet-void-refund:${betId}
    - idempotencyKey: bet-void:${betId}
  - No reputation impact (conservative, no-fault event per Wager)

### 2. Cron Grouping & Frequency
Two routes, two frequencies per financial-grade pattern:

- **/api/cron/expire-bets** (financial-critical)
  - Frequency: */5 * * * * (every 5 minutes, Vercel cron)
  - Runtime: nodejs, maxDuration: 60
  - Auth: Bearer ${CRON_SECRET} (env.ts CRON_SECRET)
  - Handles: expireOpenBet + autoVoidProposedBet services
  - Batch size: LIMIT 50 bets per run
  - Per-bet error isolation (try/catch, continue loop)
  - Response: { ok, expired, voided, errors, durationMs }

- **/api/cron/cleanup-stale** (trivial cleanup)
  - Frequency: */15 * * * * (every 15 minutes)
  - Runtime: nodejs, maxDuration: 60
  - Auth: Bearer ${CRON_SECRET}
  - Handles: BetInvite + IdempotencyKey cleanup
  - Batch size: no specific limit (DELETE queries are fast)
  - Response: { ok, invitesDeleted, keysDeleted, durationMs }

**Rationale:** Financial logic (expiry) separate from cleanup. Faster, lower latency on critical path.

### 3. Ledger Refund Flow

**Pattern:** Inverse of createBet stake hold (symmetry).

createBet (existing P13):debit: creator account
credit: bet escrow account
entryType: ESCROW_LOCK
note: bet-hold:${betId}:creator

P15 expire-refund (inverse):
debit: bet escrow account
credit: creator account
entryType: ESCROW_RELEASE
note: bet-expire-refund:${betId}

**Concurrency safety:**
- SELECT FOR UPDATE on bet within tx
- Re-check bet.status == "OPEN" AND expiresAt < now (race-safe)
- recordTransaction idempotencyKey prevents double-refund on re-fire

**Fee-agnostic design:**
- P15 refunds: "debit escrow → credit user" (whatever balance is there)
- NOW (Wager pattern): escrow.balance = stake (25 USDC)
- LATER (P18 creation fee): escrow.balance = stake - fee (24.50 USDC)
- P15 logic UNCHANGED = refund escrow.balance (works before + after fee impl)

### 4. BET_EXPIRED Reputation Hook

- **Event:** BET_EXPIRED (delta: -2 per REPUTATION_DELTAS)
- **Trigger:** bet.status OPEN → EXPIRED transition
- **Subject:** creator only (opponent never existed)
- **Idempotency key:** ${userId}:BET_EXPIRED:bet:${betId} (per P14 B.4 pattern)
- **Idempotency:** silent replay (hook fires max once per bet-expire)
- **Wiring:** inside expireOpenBet service, within tx, after ledger recordTransaction
- **Not fired:** VOID timeout (Wager no-fault pattern = no reputation impact)

### 5. Concurrency & Crash Recovery

- **SELECT FOR UPDATE:** Lock bet row within tx, prevent concurrent expire on same bet
- **Batch size:** LIMIT 50 bets per cron run (prevents long tx, allows recovery)
- **Per-bet error isolation:** try/catch around expireOpenBet(betId), log error, continue loop
  - Rationale: one bad bet doesn't block others
- **Idempotency protection:** idempotencyKey on ledger tx prevents double-refund at Vercel re-fire
  - Vercel may fire same cron twice (internal retry) — idempotency key is guard
- **Stale state check:** bet.status re-read within tx before UPDATE (race-safe against manual cancel)
- **Max iterations per run:** none hardcoded, but LIMIT 50 + 5min freq = ~500 bets/hour max

### 6. Observability

- **Logger pattern:** matches reconcile route (src/app/api/cron/reconcile/route.ts)
- **Per-run counters:**
  - n_expired: count bets transitioned to EXPIRED
  - n_voided: count bets transitioned to VOID
  - n_refunded: count successful ledger txs
  - n_errors: count exceptions
  - durationMs: total run time
- **Log level:** info on success, warn on partial errors, error on critical fail
- **Response:** JSON with counters (allows monitoring via response body parsing)
- **No circuit-breaker:** P15 is autonomous (unlike deposits/withdrawals which interact w/ Solana RPC). Errors are retryable on next 5min tick.

### 7. Test Infrastructure

- **Location:** src/__tests__/cron/expire-bets.test.ts (new dir)
- **Time-travel:** vi.useFakeTimers() for expiresAt/confirmDeadline manipulation
- **Test categories:**
  1. expireOpenBet service unit tests (3 tests)
  2. autoVoidProposedBet service unit tests (2 tests)
  3. Cron route integration tests (2 tests: auth check, happy path)
  4. Cleanup service unit tests (2 tests: BetInvite + IdempotencyKey)
  5. Backward-compat verify (run existing bet-settlement tests post-P15, should still green)
- **Idempotency test:** fire same cron payload twice, verify single ledger entry + single reputation event
- **Batch limit test:** create 100 expired bets, verify LIMIT 50 batch, remaining in next cron run
- **Error isolation test:** one bad bet in batch, verify others succeed + error logged
- **Pattern:** matches P14 B.4 test structure (scoped PRIVY_PREFIX for test cleanup)

## Schema

**No new fields required.**

Existing fields sufficient:
- Bet.expiresAt DateTime (required, set in createBet)
- Bet.confirmDeadline DateTime? (optional, set in proposeResult)
- Bet.status enum (existing EXPIRED, VOID statuses)
- BetInvite.expiresAt DateTime (existing)
- IdempotencyKey.expiresAt DateTime? (existing, nullable)

Indexes already present per discovery:
- BetInvite@@index([expiresAt])
- IdempotencyKey@@index([expiresAt])

## Service Surface

### expireOpenBet(betId: string, tx: TxClient)
- Input: betId, tx client
- Logic: SELECT...FOR UPDATE, re-check status/expiresAt, ledger refund, status UPDATE, BET_EXPIRED hook
- Return: { bet, ledgerTxId, reputationEventId }
- Error: BetError INVALID_BET_ID / INVALID_BET_STATUS

### autoVoidProposedBet(betId: string, tx: TxClient)
- Input: betId, tx client
- Logic: SELECT...FOR UPDATE, re-check status/confirmDeadline, split refund to both, status UPDATE, NO reputation hook
- Return: { bet, ledgerTxIds: [creatorTx, opponentTx] }
- Error: BetError INVALID_BET_ID / INVALID_BET_STATUS

### deleteExpiredBetInvites(tx: TxClient)
- Input: tx client
- Logic: DELETE FROM BetInvite WHERE expiresAt < NOW() AND usedAt IS NULL
- Return: { deletedCount }

### deleteExpiredIdempotencyKeys(tx: TxClient)
- Input: tx client
- Logic: DELETE FROM IdempotencyKey WHERE expiresAt IS NOT NULL AND expiresAt < NOW()
- Return: { deletedCount }

## Implementation Phases

### Fase A: Spec lock (this file)
### Fase B.0: Services (expireOpenBet, autoVoidProposedBet, cleanup helpers)
### Fase B.1: Cron routes (/api/cron/expire-bets, /api/cron/cleanup-stale)
### Fase B.2: vercel.json cron config update
### Fase B.3: Tests (15+ tests across scenarios)
### Fase B.4: Backward-compat verify + final commit

## Acceptance Criteria

1. ✓ OPEN bets expire automatically after expiresAt
2. ✓ Creator receives full refund (escrow balance) on OPEN expire
3. ✓ PROOF_SUBMITTED bets void after confirmDeadline
4. ✓ Both participants receive equal refund on VOID (escrow / 2)
5. ✓ BET_EXPIRED event fires for creator only (-2 delta), idem-safe
6. ✓ No reputation impact on VOID (Wager pattern)
7. ✓ BetInvite cleanup removes expired unused tokens
8. ✓ IdempotencyKey cleanup removes expired rows
9. ✓ Cron routes auth-gated via Bearer CRON_SECRET
10. ✓ Batch size LIMIT 50, per-bet error isolation
11. ✓ 15+ tests groen on Vercel + local
12. ✓ Existing bet tests remain groen (backward-compat)
13. ✓ Fee-agnostic refund logic (works before + after creation fee P18)

## Files Touched
docs/PROMPT_15_cron_expiry.md           [NEW]
src/lib/bets/expire.ts                  [NEW] expireOpenBet service
src/lib/bets/cleanup.ts                 [NEW] or merged into expire.ts
src/lib/bets/service.ts                 [MODIFY] add expireOpenBet export
src/app/api/cron/expire-bets/route.ts   [NEW] cron handler
src/app/api/cron/cleanup-stale/route.ts [NEW] cron handler
src/tests/cron/expire-bets.test.ts  [NEW] 15 tests
vercel.json                             [MODIFY] add 2 cron entries
prisma/schema.prisma                    [UNCHANGED] no new fields

## Deferred to P15b/P16/P17

- Dispute auto-escalation (P15b, needs schema migration)
- RESULT_PROPOSED auto-settle (P16, business rule + UX impact)
- Admin notification (P17+)
- Creation fee (P18+)
- Score decay / reputation expiry (P18+)
