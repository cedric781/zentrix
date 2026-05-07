# Known Issues — Zentrix

## Auth (uit PROMPT_03)

### 1. Multiple pnpm-lock.yaml workspace warning
- C:\Users\rapha\pnpm-lock.yaml bestaat (van ander oud project)
- Turbopack pakt dat als project root
- FIX VOOR PROMPT_05: zet turbopack.root: __dirname in next.config.ts
- Of: verwijder C:\Users\rapha\pnpm-lock.yaml (controleer eerst of
  geen oud project ervan afhankelijk is)

## PROMPT_09 leftover items

- POOL_NOT_FOUND not directly tested for createPool/publishPool/closePool
  (only cancelPool) — implicit via existence checks but no explicit test.
  createPool takes no poolId (N/A); publishPool/closePool covered implicitly.
  Low risk for MVP — schema FK + service guards both block it.
- Helper duplicatie tussen pool-escrow-invariant.test.ts en
  pool-lifecycle.test.ts (makeUser, SUFFIX, PRIVY_PREFIX patroon) — extract
  naar src/__tests__/pools/_helpers.ts in PROMPT_10 wanneer 3+ test files
  dezelfde helpers nodig hebben.
- cancelPool with bets edge case (OPEN/CLOSED with placed bets) deferred to
  PROMPT_15 cancelPoolWithRefund (per-entry BET_REFUND ledger entries +
  escrow drain + status → REFUNDED).
- closePool 'by' parameter not persisted — audit-log column deferred to
  PROMPT_14 (DisputeLog/AuditLog table).
