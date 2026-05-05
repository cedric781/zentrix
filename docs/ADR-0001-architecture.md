# ADR-0001 — Architecture for Zentrix

**Status:** Accepted
**Date:** 2026-05-05
**Supersedes:** All implicit architecture decisions in the original Wager codebase (commit 033b861)

---

## Context

The original Wager platform accumulated three parallel code trees (`src/`, `backend/`, `services/api/`), three Prisma schemas, three smart contract versions, and 53 debug scripts over ~18 months. A pivot from EVM/Base to Solana/Privy halfway through invalidated significant portions of the EVM stack but left them in the repo. The result is a working but fragile production system that is hard to reason about and hard to deploy.

This ADR locks in the architecture for Zentrix (a new repository, not a refactor of the old one) **before any code is written**. The intent is to make explicit the choices that were implicit in the original Wager, and to document the rejected alternatives so that future-me does not re-litigate them.

---

## Decisions

### D1 — Single Next.js application, single Vercel deployment

**Decision:** All server-side and client-side code lives in **one Next.js 15+ app**, deployed as **one Vercel project**. No separate Node service. No monorepo with packages. No workspace.

**Rationale:** The single biggest cause of complexity in the original Wager was the existence of three code trees that needed to stay in sync (and didn't). Vercel + Next.js Server Components + Route Handlers + Prisma can comfortably serve a wagering platform up to ~50k MAU. We do not have that scale problem. We have an architecture problem. Solving the architecture problem first is correct ordering.

**Rejected alternatives:**

1. **Monorepo with `apps/web`, `apps/worker`, `packages/shared`.** Rejected because the user explicitly stated they had problems with multiple repos / multiple deploy targets in their previous platform. A monorepo also requires pnpm workspace tooling that adds setup friction without solving any real problem at this scale. The shared types are achievable via a `src/lib/types/` directory in the single app.

2. **Separate Express/Fastify backend service for the API.** Rejected because Next.js Route Handlers handle the same load with less infrastructure. A separate API service makes sense at >50k MAU where you want independent scaling, or when the API is consumed by mobile apps. Neither is true today.

3. **Cloudflare Workers + D1 instead of Vercel + Postgres.** Rejected because the original Wager's Solana / Helius / Privy integrations are documented and tested against Node.js runtime. CF Workers force a partial rewrite of the deposit pipeline (different fetch semantics, no native bigint in some libs). The tail risk on a stack swap is not worth the marginal cost saving.

---

### D2 — One Prisma schema, no parallel `*.prisma` files

**Decision:** Exactly one file at `prisma/schema.prisma`. Every model, every enum, every migration goes through this single file. No `escrow-schema.prisma`, no `*-additions.prisma`, no `services/*/prisma/` directory.

**Rationale:** The original Wager had `services/api/prisma/` with 10 separate `*-additions.prisma` files (`audit-additions.prisma`, `chain-additions.prisma`, `proof-dispute-additions.prisma`, etc.). These were merged-by-hand into the canonical schema, with predictable drift. The post-mortem documents reference at least three User-model versions cohabiting in one schema as a result.

**Migrations:** named with descriptive verbs and feature names — never with version numbers, never with words like "fix", "robust", "hardening", "v2". A migration named `add_withdrawal_address_validation` is correct. A migration named `withdrawal_robust_v2_fix` is a code smell that says the previous migration shouldn't have shipped.

**Rejected alternatives:**

1. **Schema-per-domain (`prisma/wagers.prisma`, `prisma/ledger.prisma`).** Rejected because Prisma does not support multi-file schemas as a first-class feature (preview feature only as of Prisma 5.x), and the workaround is fragile. The benefit (smaller files) is small; the cost (drift, merge conflicts, partial regenerations) is real.

2. **Drizzle ORM instead of Prisma.** Rejected because Wager's working ledger code is written in Prisma and porting it loses bug-fixed-by-experience. Drizzle has merit for simpler apps but the Prisma migration system + introspection + `$transaction` semantics are the parts that worked in Wager. Stick with what works.

---

### D3 — Solana + USDC + Privy embedded wallets (same custody as Wager)

**Decision:** Custody via **Privy embedded wallets** (server-side key management with delegated signing). All amounts denominated in **USDC SPL tokens on Solana mainnet**. RPC via **Helius** with fallback to public mainnet RPC.

**Rationale:** The custody stack of original Wager works. The bugs were not in custody — they were in architecture (D1, D2). Privy embedded wallets are the right UX for a wagering platform: users get a wallet on signup without installing Phantom, deposits show up in their account, withdrawals can be automated with the user's delegated permission. The alternative ("connect your own wallet") raises onboarding friction by an order of magnitude — wrong choice for a betting product where the user just wants to place a bet.

**Hot-wallet vs user-wallet custody mode:** the original Wager has a `getCustodyMode()` switch between `USER_EMBEDDED` (each user signs their own outflow) and `PLATFORM_HOT_WALLET` (platform signs from a hot wallet that aggregates funds). Zentrix starts in **`USER_EMBEDDED` mode** and may migrate to hot-wallet later — but only after we have:
- a recon engine that proves daily ledger == on-chain
- a documented hot-wallet refill procedure
- a multisig cold-wallet treasury with documented recovery

Hot-wallet mode without those three is a custody risk that has cost real platforms real money.

**Rejected alternatives:**

1. **MetaMask / Phantom connect-your-own-wallet, no custody.** Rejected for UX reasons — see above. Acceptable for a DeFi tool, wrong for a wagering platform aimed at non-crypto-native users.

2. **Smart contract escrow (like Wager V1/V2/V3 did).** Rejected per Lesson R11. A smart contract introduces audit costs, upgrade complexity, and trust assumptions that are not yet justified by the use case. Funds are held in user-Privy-wallets (D3) and accounted for by the off-chain double-entry ledger (D5). The ledger is the source of truth; on-chain is the source of *settlement*. This separation is what Wager arrived at in its final state, after three smart contract iterations.

3. **Stablecoin other than USDC (e.g., USDT, DAI).** Rejected because USDC has the most liquid Solana on-ramps and the cleanest regulatory posture in our user's jurisdiction. Single-stablecoin design is simpler and we can add USDT later behind a feature flag.

---

### D4 — Background work via Vercel Cron Jobs and Inngest

**Decision:** Short cron jobs (≤10 sec per run) via **Vercel Cron** triggering Next.js Route Handlers. Long-running or queued jobs (sweep retry, reconciliation) via **Inngest** (free tier sufficient for current scale, called from the same Next.js app).

**Rationale:** A separate worker process is a second deploy target — Lesson R2 says no. Vercel Cron handles deposit polling (every 1 min), settlement check (every 5 min), and recon (every hour) within the 10-second function timeout. Inngest handles longer jobs with retry, observability, and dead-letter queue out of the box, and integrates with Next.js as a single API route — no second deployment.

**Rejected alternatives:**

1. **Self-hosted BullMQ + Redis worker.** Rejected because that introduces a Redis instance and a worker process — two more failure modes for a single-developer project. The original Wager had Redis (`backend/src/db/redis.ts`) and that complexity was a cost, not a benefit.

2. **AWS Lambda + EventBridge.** Rejected because we are committed to Vercel for the Next.js app, and splitting compute between Vercel and AWS doubles the env-management surface. Lesson R8 says one env store.

3. **No background work, do everything synchronously.** Rejected because deposit polling and settlement *cannot* be synchronous — they react to external events. We need at least cron-like primitives.

---

### D5 — Double-entry ledger as the financial source of truth

**Decision:** All money movements pass through a single `recordTransaction()` function that creates a `LedgerTransaction` with two or more `LedgerEntry` rows that balance to zero. The user's "balance" is **derived** from ledger entries, not stored as a mutable column. On-chain transfers are **events** that produce ledger entries; they are not the source of truth.

**Rationale:** This is the part of Wager that worked. The patterns are documented in `ADVERSARIAL_CHAOS_MATRIX.md`: FOR UPDATE on account rows, version guards on bet rows, idempotency keys with UNIQUE constraints, BigInt arithmetic with floor-division for fees. We are porting this design directly.

**Schema (canonical models from Wager, simplified):**
- `FinancialAccount` — one row per (user, bet-escrow, treasury, external-source). `scopeKey @unique` for upsert-by-scope.
- `LedgerTransaction` — one row per logical money-move, `idempotencyKey @unique`.
- `LedgerEntryV2` — debit-credit pair, references `LedgerTransaction`. (Renamed to `LedgerEntry` in v2 — no parallel table.)

**Rejected alternatives:**

1. **Single-entry "wallet table" with mutable `balance` column.** Rejected because it has no audit trail, no idempotency, no rollback semantics, and no way to prove conservation. Every fintech that does this regrets it.

2. **Event-sourcing (every state change is an event).** Rejected as overkill for the current scale. Double-entry ledger is event-sourcing for money — that's enough. Full event sourcing for non-money state (bet status, user profile) adds complexity without benefit.

---

### D6 — Single env store (Vercel project env), no `.env.production.local` as primary

**Decision:** Production environment variables live in **Vercel project environment** only. The `.env.production.local` file exists only as an emergency restore artifact in a password manager. Application startup runs a Zod schema validator on `process.env` and refuses to start if required vars are missing.

**Rationale:** The original Wager hit Vercel env-store bug ticket 01142477 which blocked production deploys for multiple commits. The team workaround was hardcoded kill-switches in code. That workaround is fine as a *temporary* measure but became permanent because the env-store wasn't fixed afterwards. Lesson R8 codifies this.

**Hardcoded kill-switches** (e.g., `WITHDRAWALS_DISABLED = true` in code) are allowed only with:
- a GitHub issue labeled `tech-debt-env-store`
- a 30-day expiry
- a comment in the code referencing the issue

**Rejected alternatives:**

1. **Doppler / Infisical for centralized secrets.** Rejected for first-month scope as it adds an external dependency for a problem we don't have yet. Revisit at month 3 if the team grows.

2. **`.env.production` checked into the repo (encrypted with `git-crypt`).** Rejected because Vercel's UI-driven env management is simpler for non-technical co-workers and avoids accidental leaks via merge conflicts. The encryption-in-git pattern is high-friction in practice.

---

### D7 — Observability and metrics in v1, not v2

**Decision:** Before any business feature ships in production, the following must exist:
1. Structured logging (pino or built-in Next.js telemetry) for every Route Handler
2. A `/api/admin/metrics` route that exposes Prometheus-style counters for: deposits credited, withdrawals executed, withdrawals failed, settlement transactions, recon mismatches
3. A `system_balance_check` cron that runs hourly and writes to a `ReconciliationLog` table — alerting on `delta != 0`
4. A `circuit_breaker` table and admin route that lets ops disable a flow with a single SQL update

**Rationale:** Lesson R3 — Wager has 53 debug scripts because observability was added late. Observability is not a "post-launch nice-to-have" for a wagering platform; it is **part of the launch**. If we can't see what's happening in production at the metric level, we are flying blind on user money.

**Rejected alternatives:**

1. **Datadog / New Relic / Sentry from day 1.** Sentry yes, for error tracking (free tier sufficient). Datadog/New Relic rejected for first-month scope due to cost; we get equivalent observability from logs + custom metrics endpoint scraped by Vercel Analytics.

2. **No metrics until first user complaint.** Strongly rejected. This is the Wager pattern that produced 53 scripts.

---

### D8 — Tests block merges; three financial invariants always run

**Decision:** CI runs Vitest on every PR. Three test files **must always pass**:
- `src/__tests__/financial/ledger-integrity.test.ts` — every `LedgerTransaction` has `SUM(debits) === SUM(credits)`
- `src/__tests__/financial/balance-invariants.test.ts` — every `FinancialAccount.balanceUnits` equals derived sum from entries
- `src/__tests__/financial/concurrency-chaos.test.ts` — 10 parallel conflicting calls produce exactly-once execution

**Rationale:** These three tests are the floor for "did we break the money model". If any of them go red, the PR cannot merge. Period. This prevents the entire class of bugs that produces fix-scripts in `/scripts/`.

**Rejected alternatives:**

1. **100% test coverage as the bar.** Rejected — coverage is a vanity metric. The three invariant tests give more safety than 100% coverage of getters and DTO mappers.

2. **Tests run only on main branch (deploy gate).** Rejected because it lets broken code into PR review where it wastes reviewer time. CI on every push is cheap; reviewer time is not.

---

## Consequences

**Positive:**
- One repo, one deploy, one schema. Cognitively cheap.
- Patterns ported from Wager's working code, not invented.
- The 12 lessons are encoded as build-time constraints (lint rules, CI checks) where possible.

**Negative:**
- We commit to Vercel as the platform. Switching costs in 6 months are real.
- Single Next.js app means one process for both UI and API; a runaway Server Component render can take down the API. Mitigated by Route Handler isolation.
- Privy is a single point of failure for custody. If Privy is down, deposits/withdrawals stop. Mitigated by clear status page communication and the kill-switch pattern.

**Open questions to revisit at 3 months:**
- Hot wallet vs user-embedded custody mode (D3) — current decision: stay user-embedded.
- Inngest vs self-hosted queue (D4) — current decision: Inngest.
- Smart contract for verifiable escrow (R11) — current decision: not until proven needed.

---

## How to amend this ADR

Do not edit this file in place. To amend a decision:
1. Create `ADR-0002-<topic>.md`
2. State `Supersedes: <decision number from ADR-0001>`
3. Document the new context that justifies the change
4. Reference the rejected alternative that you are now accepting, with the new reason

This forces deliberate revisits rather than silent drift.
