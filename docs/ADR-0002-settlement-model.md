# ADR-0002 — Pool-creator-decides settlement (with mitigations)

**Status:** Accepted
**Date:** 2026-05-07
**Decision-maker:** Raphal Bongsomenggolo (explicitly confirmed after 5 warnings from the AI assistant about the trust assumptions this decision carries)
**Supersedes:** No prior ADR. Settlement model was deliberately deferred in ADR-0001 because it depends on the v1 product shape (P2P wagering between strangers) which crystallized after phase 1 was built.

---

## Context

Zentrix is a peer-to-peer wagering platform. Anyone can sign up, fund their account with USDC, and either **create a pool** ("Will it rain in Amsterdam tomorrow?") or **enter an existing pool** by buying one of its options. When the underlying event resolves, the pool's escrow needs to be paid out to the winning side.

The question this ADR answers: **who decides which side won?** This is the most consequential design decision in a wagering platform — it is the single point where money leaves the platform's control and ends up with one party rather than another. Get this wrong and you have either (a) a platform that can't settle anything (everyone disputes), or (b) a platform where settlement is captured by bad actors.

We considered three alternative paths during phase 1 design discussions:

- **Path 1 — Oracle-based settlement.** A trusted oracle (Chainlink, custom feed) reports outcomes. Pools must be phrased in terms the oracle understands. Strong settlement guarantees, weak product guarantees (most real-world wagering pools — sports, prop bets, social events — don't fit oracle-friendly structure).
- **Path 2 — Referee per pool.** Each pool selects a paid third-party referee from a marketplace at creation time. Strong neutrality, weak feasibility for v1 (no marketplace exists yet, no pricing, no recourse).
- **Path 3 — Hybrid dispute.** Creator declares, optional dispute window with paid arbitration. Combines the worst of both worlds: still need an arbiter pool, plus you've added two settlement states and a deadlock case (split arbitration).

This ADR rejects all three and accepts the simpler model below.

---

## Decision

**The pool creator declares the winning option.** When a creator declares, the platform initiates a **24–48 hour settlement delay**. After the delay, escrow is paid out to entries on the winning side. The decision is final after the payout — no chargebacks, no protocol-level dispute resolution.

Three mitigations are mandatory parts of this decision and ship with the v1 pool feature, not as later additions:

### Mitigation 1 — Creator cannot bet on their own pool (DB constraint)

A user who creates a pool **cannot** purchase any of its options. Enforced at the schema level (foreign-key check between `Pool.createdByUserId` and `PoolEntry.userId`), not just at the API layer. The intent is to remove the most obvious manipulation vector: declare yourself the winner of a pool you also entered.

This also means a creator earns nothing from being right. Creator economics are limited to **creator fees** (a configurable percentage of pool volume that goes to the creator, capped) — see fee model in fase 2 prompts.

### Mitigation 2 — 24–48 hour settlement delay between declaration and payout

When a creator clicks "Declare winner," the pool enters a `SETTLEMENT_PENDING` state. The actual ledger payout happens 24–48 hours later via a cron-driven settlement job. The delay window is **configurable per pool** within bounds (`SETTLEMENT_DELAY_MIN_HOURS=24`, `SETTLEMENT_DELAY_MAX_HOURS=48`).

The delay exists so that:
- An obviously wrong declaration ("I declared myself winner of a clearly-not-my-side pool") is visible to entrants before money moves.
- The platform operator has time to manually trip the `settlement` circuit breaker (introduced in PROMPT_07) if a pool is reported during the window.
- Entrants have at least one full business day to surface concerns publicly.

After the delay window expires, the cron job pays out automatically. There is no "approve" step — the delay is the only friction.

### Mitigation 3 — Public dispute log, reputation-only consequences

Any user who entered a pool can post a `DisputeLog` entry against that pool's settlement during the delay window. Entries are public, immutable, and tied to the user's identity. They do **not** block the payout, do **not** trigger any economic consequence at the protocol level, and are **not** evidence in any platform-side adjudication (because there is none).

What they do: surface a public reputation signal on the pool creator. A creator with multiple disputed settlements becomes visible-as-untrustworthy to future pool entrants, which is the only feedback loop that gradually corrects bad-actor behavior in this model.

Implementation: `DisputeLog { id, poolId, userId, reason, createdAt }`, queryable per creator, surfaced in the creator's public profile.

---

## Rationale

The simplicity argument is doing the heavy lifting here:

- **No external oracle dependency.** Oracles are great for "did Bitcoin close above $X" and useless for "did my friend actually finish the marathon under 4 hours". The pools we want to support — social events, prop bets, niche sports — are mostly oracle-incompatible.
- **No arbiter marketplace to bootstrap.** A referee marketplace is itself a chicken-and-egg problem: no pools means no referees means no pools. Path 2 turns "build a wagering platform" into "build a wagering platform AND a freelance arbitration marketplace."
- **Faster to build.** The settlement code path is one cron job, one state machine, three states (`PENDING_SETTLEMENT → SETTLED | DISPUTED → PAID_OUT`). Path 1 needs an oracle integration; Path 3 needs an arbiter pool, dispute states, and deadlock handling.
- **Honest about what we are.** v1 Zentrix is a tool for friend-groups and small communities to bet on things. In those contexts, the creator is usually known to the entrants. Rug-pull risk is moderated by social cost, not protocol cost. A platform that pretends otherwise (with elaborate dispute machinery) is selling a guarantee it cannot deliver.

Most importantly: this design does not foreclose the others. If Path 1 (oracle) becomes attractive for sports pools, it can ship as a per-pool *option* later — "this pool is oracle-settled, that one is creator-settled" — without rebuilding the settlement engine. Same for Path 2.

---

## Acknowledged risks

This is a trust-asymmetric system and we are choosing to ship it. The risks must be stated, not hand-waved:

1. **Scam potential.** A creator can build a pool, attract entrants, and declare their preferred outcome regardless of reality. Mitigation 1 removes the lowest-friction case (creator-as-entrant), but a creator can still collude with an off-platform party who is the entrant on the "winning" side.
2. **Rug-pull at low-reputation creators.** A new creator with no prior pools has no reputation cost from one bad settlement. The first scam is "free" in this system. Mitigation 3 makes the second one expensive — but the first one ships money to the wrong party.
3. **Scaling pressure on arbitration.** Above some pool count or some scam frequency, the social-cost feedback loop is too slow. The platform will need real arbitration (Path 1 or Path 2) to keep growing without losing user trust. We do not know where that threshold is, and we will only learn empirically.
4. **No platform-side recourse.** If a user is scammed, the platform offers nothing beyond the public dispute log. Customer support cannot reverse a settlement. This must be communicated clearly in the ToS and signup flow — not buried.
5. **Operator burden.** During the 24–48 hour window, the operator (currently: solo) is the de-facto last line of defense. If a clearly fraudulent pool is reported, the operator must trip the breaker manually. This does not scale beyond ~dozens of concurrent pools per operator.

---

## Rejected alternatives

### Path 1 — Oracle-based settlement (Chainlink-style)

**Rejected.** Too complex for MVP and structurally incompatible with the pool types we want to support. Most pools we expect (social events, friend-group prop bets, niche outcomes) do not have an oracle source. Forcing every pool through an oracle-friendly schema would limit the product to a narrow domain (price feeds, major sports) where existing markets already serve users better.

May return as a **per-pool option** in fase 3 once we have enough pool volume to justify the integration cost.

### Path 2 — Referee per pool (paid third-party arbitration marketplace)

**Rejected.** Requires a referee marketplace that does not exist. Bootstrapping it is a separate product. The cost-of-arbitration also makes small pools economically unviable (referee fee > pool size).

May return in fase 3 as an opt-in for **high-stakes pools** (above some threshold, e.g. >$1k escrow), where the referee fee is amortized.

### Path 3 — Hybrid dispute (creator declares, optional paid arbitration during dispute window)

**Rejected.** Combines the implementation cost of Path 2 (need an arbiter pool) with the state-machine complexity of multi-stage settlement. The dispute window adds two states to handle and a deadlock case (split arbitration) that has no clean resolution. The simpler 24–48 hour delay (Mitigation 2) gets most of the deterrence value without those costs.

---

## Review trigger

This ADR is intentionally not "the final settlement model." It is the model we ship v1 with, and it is explicitly subject to review when **either** of the following occurs:

- **3 confirmed scams** (settlements that an objective external observer would call fraudulent) — at that point the social-cost feedback loop is demonstrably insufficient.
- **100+ pools** with active escrow — at that point the operator-as-last-line-of-defense burden exceeds what one person can carry.

Whichever happens first triggers a re-evaluation against Path 1 and Path 2. The re-evaluation must produce either an amended ADR-0002 or a superseding ADR.

Until either trigger fires, the model stands as-is and feature work does not relitigate it.

---

## Decision-making record

This decision was made by **Raphal Bongsomenggolo** on 2026-05-07. The AI assistant (Claude) raised five distinct warnings during the design discussions about the trust assumptions this model carries:

1. The first scam ships money before reputation can warn anyone.
2. "Public dispute log" without economic consequence is a weaker signal than users typically assume.
3. ToS disclaimers do not reliably move regulatory or PR risk.
4. The operator-as-circuit-breaker pattern does not scale past dozens of concurrent pools.
5. A first-time user has no way to evaluate creator reputation before entering.

Each warning was acknowledged. The decision was made anyway, with the explicit reasoning that **shipping a working v1 with known trust limits beats not shipping while waiting for a perfect arbitration design**. The mitigations above are the price of that decision.

This record exists so future-Raphal (and future contributors) cannot tell themselves "we didn't see this coming." We saw it coming. We chose to ship.
