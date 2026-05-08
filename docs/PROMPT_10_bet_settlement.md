# PROMPT_10 — Bet settlement services (PROOF_CONFIRM flow)

**Refactor fase 3 deliverable.** Settlement-laag bovenop de lifecycle services uit P09, conform [ADR-0003](./ADR-0003-1v1-with-tournament-pools.md) §1 (status graph + PROOF_CONFIRM mode), §3 (fees), §5 (idempotency), en [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) §4 (PROMPT_10 scope).

---

## Doel

Implementeer de drie services die een ACTIVE 1v1 bet doorzetten naar SETTLED of DISPUTED:

- `proposeResult` — een participant claimt een winnaar; bet promoveert ACTIVE → RESULT_PROPOSED, `confirmDeadline` wordt gezet.
- `confirmResult` — de niet-claimant confirmeert (CONFIRM_WINNER) of betwist (DISAGREE) de claim. CONFIRM_WINNER triggert direct settle in dezelfde tx; DISAGREE markeert bet DISPUTED zonder geld te verplaatsen.
- `settleBet` (helper) — gemeenschappelijke ledger-flow voor SETTLED transities: pot uit escrow naar winner minus 2% fee naar treasury. Wordt gebruikt door `confirmResult` (PROOF_CONFIRM happy path) én later door P13 dispute resolution.

**Niet** in scope:
- Pool-attached bet settlement (creator submits match-result → all-bets-on-match SETTLED) — komt **PROMPT_12**. Pool-attached bets worden in P10 services expliciet geweigerd (zie #8).
- Dispute open / resolve services — komen **PROMPT_13**.
- Auto-settle bij idle `confirmDeadline` — komt **PROMPT_15** (cron).
- HTTP routes + `withIdempotency` wrapper — komen **PROMPT_16**.

Test count target na P10: 70 → 88 (18 nieuwe settlement tests).

---

## Builds on

- **PROMPT_07** — `recordTransaction` met sorted-id account locks + `LedgerTransaction.idempotencyKey @unique`. Onaangetast in P10.
- **PROMPT_08** (commit `1618b27`, tag `refactor-fase-1`) — `BetResultClaim` (met `@@unique([betId, claimedById])` als natural-idempotency-anchor), `BetParticipantConfirmation` (zonder unique — service-laag guard), `BetStateTransition`, `Bet.confirmDeadline / settledAt / winnerId / version` velden, `FEES.PLATFORM_BPS = 200`, re-exported `applyBps`.
- **PROMPT_09** (commit `c48927c`, tag `refactor-fase-2`) — `lockBet` helper, `wrapTriggerError` pattern (niet hergebruikt in P10 want geen bet-inserts), `BetError` class met 10 codes, idempotency-key UUID v4 validatie, `prisma.$transaction`-wrap convention.
- **ADR-0003 §1** — status graph `ACTIVE → RESULT_PROPOSED → SETTLED` voor de happy path (P10 gebruikt geen `AWAITING_CONFIRMATION` intermediate state — zie #14 + Q2-resolved); `RESULT_PROPOSED → DISPUTED` voor disagree; `BetStatus` 10 waardes vast (geen nieuwe statussen toegevoegd).
- **ADR-0003 §3** — `PLATFORM_BPS: 200` (2%) bij settlement, winner-only. Geen fee bij DISPUTE-status (komt pas bij dispute-resolution in P13). `creation fee = 0%`.
- **ADR-0003 §5** — ledger-laag deterministic keys. P10 introduceert `bet-settle:{betId}` (één-per-bet, terminal).

---

## Files touched

| File | Mutatie | Omvang |
|---|---|---|
| `src/lib/bets/errors.ts` | EDIT — voeg 6 nieuwe codes toe aan `BetErrorCode` union | +6 regels |
| `src/lib/bets/service.ts` | EDIT — export bestaand `lockBet`, voeg `proposeResult` + `confirmResult` toe | +~280 regels |
| `src/lib/bets/settlement.ts` | NEW — `settleBet` helper (intra-tx, exported voor P13 reuse) | ~80 regels |
| `src/__tests__/bets/bet-settlement.test.ts` | NEW — 18 tests (5 propose + 5 confirm-winner + 3 confirm-disagree + 5 edge cases) | ~700 regels |

Geen aanpassingen aan `prisma/schema.prisma`. Geen nieuwe migrations. P10 leunt volledig op P08 schema.

---

## Pre-flight verificatie

```bash
cd ~/zentrix

# 1. Branch + commit state
git status                                       # clean working tree
git log --oneline -1                             # c48927c (refactor-fase-2)
git tag -l | grep refactor-fase-2                # bestaat

# 2. Tests baseline = 70
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  70 passed (70)"

# 3. Schema: BetResultClaim heeft natural-uniqueness
grep -E "@@unique\(\[betId, claimedById\]" prisma/schema.prisma
# Verwacht: 1 match (model BetResultClaim)

# 4. fees.ts heeft PLATFORM_BPS = 200
grep "PLATFORM_BPS" src/lib/fees.ts
# Verwacht: PLATFORM_BPS: 200

# 5. lockBet helper bestaat (private helper in P09 service.ts)
grep "async function lockBet" src/lib/bets/service.ts
# Verwacht: 1 match — moet exported worden in Step 2

# 6. ConfirmationDecision enum heeft CONFIRM_WINNER en DISAGREE
grep -A 3 "enum ConfirmationDecision" prisma/schema.prisma
# Verwacht: CONFIRM_WINNER + DISAGREE

# 7. WSL heap-flag conventie
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"
```

Stop bij rood op één van deze checks. Niet doorgaan zonder root cause.

---

## Beslissingen

17 numbered decisions. Format: **wat** (concrete shape) + **waarom** (rationale + ADR-bron).

### 1. Zes nieuwe `BetErrorCode` waardes — uitbreiding op de 10 bestaande

```typescript
export type BetErrorCode =
  // P09 (10 bestaand):
  | "BET_NOT_FOUND" | "BET_NOT_OWNED_BY_CALLER" | "BET_INVALID_STATUS"
  | "BET_INVITE_INVALID" | "BET_ALREADY_ACCEPTED" | "BET_EXPIRED"
  | "BET_INSUFFICIENT_BALANCE" | "BET_VERSION_MISMATCH"
  | "BET_INVALID_INPUT" | "BET_CREATOR_BETTING_OWN_POOL"
  // P10 nieuw (6):
  | "BET_NOT_PARTICIPANT"             // 403 — caller is geen creator/opponent van de bet
  | "BET_RESULT_ALREADY_CLAIMED"      // 409 — caller heeft al een claim ingediend
  | "BET_RESULT_CLAIM_NOT_FOUND"      // 404 — confirm zonder voorafgaande claim
  | "BET_CONFIRM_BY_CLAIMANT"         // 403 — claimant kan niet zichzelf confirmeren
  | "BET_DEADLINE_PASSED"             // 409 — confirmDeadline voorbij; auto-settle hoort over te nemen
  | "BET_SETTLEMENT_LEDGER_ERROR";    // 500 — recordTransaction faalde tijdens settle
```

**Statuscode mapping:**
| Code | HTTP | Wanneer |
|---|---|---|
| BET_NOT_PARTICIPANT | 403 | proposeResult/confirmResult: `callerId !∈ {createdById, opponentUserId}` |
| BET_RESULT_ALREADY_CLAIMED | 409 | proposeResult: `(betId, callerId)` heeft al een BetResultClaim row |
| BET_RESULT_CLAIM_NOT_FOUND | 404 | confirmResult: geen BetResultClaim voor deze bet |
| BET_CONFIRM_BY_CLAIMANT | 403 | confirmResult: caller is gelijk aan `claim.claimedById` |
| BET_DEADLINE_PASSED | 409 | proposeResult: `bet.expiresAt < now`. confirmResult: `bet.confirmDeadline < now` |
| BET_SETTLEMENT_LEDGER_ERROR | 500 | settleBet: onverwachte ledger-engine fout |

`BET_DEADLINE_PASSED` is gescheiden van `BET_EXPIRED` om nuance te bewaren — `BET_EXPIRED` = accept-deadline gemist (P09); `BET_DEADLINE_PASSED` = confirm-deadline gemist (P10/P15 cron).

---

### 2. `proposeResult` input + flow

```typescript
export interface ProposeResultInput {
  betId: string;
  callerId: string;
  claimedWinnerId: string;
  note?: string;
  idempotencyKey: string;       // UUID v4
}

export interface ProposeResultResult {
  bet: Bet;
  claim: BetResultClaim;
}
```

Flow (in `prisma.$transaction`):

```text
1. Cheap input validation:
   - assertUuidV4(idempotencyKey)
   - note (indien gezet) length <= 1000 chars

2. Natural idempotency check via BetResultClaim @@unique([betId, claimedById]):
   - findUnique waar betId+claimedById match.
   - Als gevonden: re-fetch bet, return { bet, claim } silent-success.
     (Replay-detection: caller heeft al geclaimd, zelfde service-call returns same.)

3. lockBet(tx, betId).
   Re-fetch bet via findUniqueOrThrow.

4. Guards:
   - bet.poolId === null  → anders BET_INVALID_STATUS ("pool-attached bets settle via match result"). Zie #8.
   - bet.status === "ACTIVE" → anders BET_INVALID_STATUS.
   - bet.expiresAt > now → anders BET_DEADLINE_PASSED.
   - callerId ∈ {bet.createdById, bet.opponentUserId} → anders BET_NOT_PARTICIPANT.
   - claimedWinnerId ∈ {bet.createdById, bet.opponentUserId} → anders BET_INVALID_INPUT.

5. Insert BetResultClaim:
   { betId, claimedById: callerId, claimedWinnerId, note: note ?? null }
   Catch P2002 (race): @@unique violation → re-fetch existing claim, return silent-success
   (defense-in-depth voor stap 2 race tussen tx's).

6. updateMany Bet met version-guard:
   WHERE id, version: bet.version, status: "ACTIVE"
   SET status: "RESULT_PROPOSED",
       resultStatus: "PROPOSED",
       winnerId: claimedWinnerId,
       confirmDeadline: new Date(Date.now() + 24 * 3600_000),
       version: bet.version + 1
   Count !== 1 → BET_VERSION_MISMATCH.

7. Insert BetStateTransition:
   { betId, fromStatus: "ACTIVE", toStatus: "RESULT_PROPOSED",
     actorId: callerId, actorType: "USER",
     metadata: { claimedWinnerId, claimId: claim.id, note: note ?? null } }

8. Re-fetch bet, return { bet, claim }.
```

**`winnerId` is preliminary** in `RESULT_PROPOSED`-state — staat op de eerste claim's keuze. Als de niet-claimant later DISAGREE doet, `winnerId` blijft staan tot admin-resolution in P13 (zie #9).

**Geen ledger movement.** `proposeResult` mutates alleen status + audit. Geen money flow tot `settleBet`.

---

### 3. `confirmResult` input shape

```typescript
export interface ConfirmResultInput {
  betId: string;
  callerId: string;
  decision: "CONFIRM_WINNER" | "DISAGREE";
  claimedWinnerId?: string;     // alleen bij DISAGREE — vereist
  idempotencyKey: string;       // UUID v4
}

export interface ConfirmResultResult {
  bet: Bet;
  confirmation: BetParticipantConfirmation;
}
```

**Velden:**
- `decision` literal-union; service rejects andere waardes (defense-in-depth voor TypeScript-loze callers).
- `claimedWinnerId` alleen vereist bij `DISAGREE`. Bij `CONFIRM_WINNER` impliceert de bestaande claim de winnaar — input-veld wordt genegeerd ook al gezet.
- `idempotencyKey` blijft caller-supplied UUID v4. Replay-mechanisme via natural-DB-state op `BetParticipantConfirmation` (zie #7), niet via key-lookup.

---

### 4. `confirmResult` happy path — CONFIRM_WINNER pad

Flow (in `prisma.$transaction`):

```text
1. assertUuidV4(idempotencyKey).
   decision === "CONFIRM_WINNER" || "DISAGREE", anders BET_INVALID_INPUT.
   decision === "DISAGREE" requires claimedWinnerId, anders BET_INVALID_INPUT.

2. Natural-DB-state idempotency: zoek BetParticipantConfirmation
   WHERE betId AND userId = callerId.
   Als gevonden: re-fetch bet, return { bet, confirmation } silent-success.
   (Caller heeft al beslist; replay returnt huidige state.)

3. lockBet(tx, betId).
   Re-fetch bet.

4. Guards:
   - bet.status === "RESULT_PROPOSED" → anders BET_INVALID_STATUS.
   - bet.confirmDeadline (niet null) > now → anders BET_DEADLINE_PASSED.
   - callerId ∈ {createdById, opponentUserId} → anders BET_NOT_PARTICIPANT.
   - Zoek de bestaande BetResultClaim WHERE betId.
     Geen claim → BET_RESULT_CLAIM_NOT_FOUND (defensief; status check zou
     dit al uitsluiten, maar belt-and-braces).
   - claim.claimedById !== callerId → anders BET_CONFIRM_BY_CLAIMANT.

5. Path: decision === "CONFIRM_WINNER":
   a. Insert BetParticipantConfirmation:
      { betId, userId: callerId, decision: "CONFIRM_WINNER",
        claimedWinnerId: claim.claimedWinnerId }
      (stored value = de daadwerkelijke winnaar zoals geclaimd; consistent
      voor reporting.)

   b. Markeer beide BetParticipants hasConfirmed=true via updateMany
      WHERE betId. confirmedAt = now.

   c. Roep settleBet helper (zie #6) binnen dezelfde tx aan met
      winnerId = claim.claimedWinnerId, fromStatus = "RESULT_PROPOSED".
      settleBet doet zelf de status-update (RESULT_PROPOSED → SETTLED)
      met version-guard én de bijbehorende BetStateTransition row.

6. Re-fetch bet (na settleBet → status SETTLED), return.
```

**Direct `RESULT_PROPOSED → SETTLED` ipv intermediate `AWAITING_CONFIRMATION`:** één status-update + één BetStateTransition row in plaats van twee. `AWAITING_CONFIRMATION` blijft in de `BetStatus` enum (geen schema-mutatie) maar wordt door P10 niet gebruikt. Mogelijk wel relevant in een later multi-arbiter scenario; geen verlies. Cost-saving: één extra UPDATE + audit-row vermeden in de hot path. ADR-0003 §1 graph blijft consistent — `AWAITING_CONFIRMATION` is een legaal pad in de enum maar niet verplicht voor PROOF_CONFIRM bilateraal. Zie Q2-resolved.

**`hasConfirmed=true` voor beide participants:** zowel claimant als confirmer worden gemarkeerd. Claimant's "confirmation" is impliciet via hun eerdere ResultClaim. Single source-of-truth voor "was deze bet door beide partijen erkend".

---

### 5. `confirmResult` DISAGREE pad

```text
5'. Path: decision === "DISAGREE":
   a. claimedWinnerId !== claim.claimedWinnerId → anders BET_INVALID_INPUT
      ("DISAGREE met zelfde winner = functional equivalent van CONFIRM").
      claimedWinnerId ∈ {createdById, opponentUserId} → anders BET_INVALID_INPUT.

   b. Insert BetParticipantConfirmation:
      { betId, userId: callerId, decision: "DISAGREE",
        claimedWinnerId } // de tegenclaim

   c. updateMany Bet met version-guard:
      WHERE id, version, status: "RESULT_PROPOSED"
      SET status: "DISPUTED", resultStatus: "DISPUTED", version++.
      `winnerId` blijft op originele claim (admin override mogelijk in P13).

   d. Insert BetStateTransition (RESULT_PROPOSED → DISPUTED,
      actor=callerId,
      metadata: { confirmationId, disagreedWinnerId: claimedWinnerId }).

6'. Re-fetch bet, return.
```

**Geen ledger movement bij DISAGREE.** Escrow blijft vast tot dispute-resolution (P13).

**Geen `confirmDeadline` reset bij DISPUTED.** De originele 24h-deadline blijft staan als tijdsstamp; admin kan negeren bij dispute-handling.

---

### 6. `settleBet` helper

```typescript
// src/lib/bets/settlement.ts
import "server-only";
import { applyBps, FEES } from "@/lib/fees";
import {
  recordTransaction, getUserAccount, lockAccount, getTreasuryAccount,
  type TxClient,
} from "@/lib/ledger";
import { getOrCreateBetEscrowAccount } from "./escrow";
import { BetError } from "./errors";
import type { Bet } from "@prisma/client";

export interface SettleBetInput {
  bet: Bet;                    // already lockBet-ed by caller
  winnerId: string;            // member of {bet.createdById, bet.opponentUserId}
  ledgerIdempotencyKey: string; // typically "bet-settle:{betId}"; dispute path uses other
  fromStatus: "RESULT_PROPOSED" | "DISPUTED";  // expected current status
  actorId: string | null;      // null voor systeem-driven settle (cron); else userId
}

export async function settleBet(
  tx: TxClient,
  input: SettleBetInput,
): Promise<Bet>;
```

Flow:

```text
1. Validate winnerId ∈ {bet.createdById, bet.opponentUserId}.
   Anders: BetError("BET_INVALID_INPUT", "winnerId must be a participant").

2. potUnits = bet.stakeUnits * 2n
   feeUnits = applyBps(potUnits, FEES.PLATFORM_BPS)   // 2% van pot
   winnerPayout = potUnits - feeUnits

3. Lock accounts (sorted-id done by recordTransaction):
   - winner user account (via getUserAccount(tx, winnerId))
   - bet escrow (via getOrCreateBetEscrowAccount)
   - treasury (via getTreasuryAccount)

4. recordTransaction:
   idempotencyKey: input.ledgerIdempotencyKey
   description: `Bet settlement (bet=${bet.id})`
   initiatorUserId: input.actorId ?? winnerId  // fallback voor cron path
   refType: "bet", refId: bet.id
   lines (2 lines, een single transaction):
     a. DEBIT escrow.id, CREDIT winner.id, amount: winnerPayout,
        entryType: "SETTLEMENT_PAYOUT", note: `bet-settle-payout:{betId}`
     b. DEBIT escrow.id, CREDIT treasury.id, amount: feeUnits,
        entryType: "FEE_COLLECTION", note: `bet-settle-fee:{betId}`
   (Twee lines, totaal escrow debit = potUnits, balanced.)

5. updateMany Bet:
   WHERE id, version: bet.version, status: input.fromStatus
   SET status: "SETTLED", resultStatus: "CONFIRMED",
       settledAt: new Date(), version: bet.version + 1
   Count !== 1 → BET_VERSION_MISMATCH.

6. Insert BetStateTransition:
   { betId, fromStatus: input.fromStatus, toStatus: "SETTLED",
     actorId: input.actorId, actorType: input.actorId ? "USER" : "SYSTEM",
     metadata: { ledgerTxId: ledgerResult.transaction.id,
                 winnerPayout: winnerPayout.toString(),
                 feeUnits: feeUnits.toString() } }

7. Return tx.bet.findUniqueOrThrow({where: {id: bet.id}}).
```

**Twee aparte LedgerEntry-lines binnen één LedgerTransaction:** elke line is intern balanced (één DEBIT + één CREDIT, gelijke amount). De som over de transaction blijft ook balanced (escrow → potUnits debit, winner+treasury → potUnits credit). Dit is de standaard `recordTransaction` invariant uit P07.

**`fromStatus` parameter:** de helper accepteert `"RESULT_PROPOSED"` (PROOF_CONFIRM happy path) of `"DISPUTED"` (P13 dispute resolution). De updateMany-guard zorgt dat we vanuit de juiste status komen — voorkomt accidentele settle uit DRAFT/OPEN/CANCELLED.

**`actorType` voor system-driven settle:** P15 cron-path gebruikt `actorId: null` → `actorType: "SYSTEM"`. P10 confirmResult-path passes `actorId: callerId` → `actorType: "USER"`.

**Treasury account is geseed** — `getTreasuryAccount(tx)` throwt als ontbrekend (zie `src/lib/ledger/accounts.ts`). Pre-flight Step 0 verifieert seeding.

---

### 7. Idempotency strategie — natural-DB-state ipv ledger-key voor non-ledger ops

`proposeResult` en `confirmResult` (DISAGREE pad) muteren geen geld. Een `LedgerTransaction.idempotencyKey @unique` lookup voor "is dit al gebeurd" werkt niet — er is geen ledger-row.

**Strategie per service:**

| Service | Idempotency mechanisme | Replay-uitkomst |
|---|---|---|
| `proposeResult` | `BetResultClaim @@unique([betId, claimedById])` | Re-fetch existing claim + bet, return silent. |
| `confirmResult` (CONFIRM_WINNER) | `bet-settle:{betId}` LedgerTransaction OR existing BetParticipantConfirmation | Replay returnt SETTLED bet (na settle al gepleegd). |
| `confirmResult` (DISAGREE) | Existing BetParticipantConfirmation WHERE betId AND userId | Replay returnt DISPUTED bet + existing confirmation. |
| `settleBet` (helper) | `bet-settle:{betId}` deterministic ledger key | Bestaande ledger-tx → recordTransaction skipt writes; status-update faalt op version-mismatch; caller-laag (`confirmResult`) handelt af via natural-DB check. |

**Caller-supplied `idempotencyKey` blijft input** voor consistency met P09 + voorbereiding op P16 HTTP-wrapper. Service-laag valideert de UUID-format maar gebruikt het niet voor lookup. Een toekomstige `withIdempotency(key, ...)` HTTP-laag wrapper zal het wel gebruiken voor route-niveau dedup.

**Waarom geen no-op LedgerTransaction voor propose/confirm:** zou een zero-amount entry vereisen, maar `recordTransaction` rejects `amountUnits <= 0n`. Werkbaar pad zou zijn een aparte tabel of `IdempotencyKey` extended-shape gebruiken — beide zijn over-engineering voor wat natural-DB-state al biedt. Zie open Q1 voor mogelijke heroverweging.

---

### 8. Pool-attached bets — out of scope, expliciet geweigerd

P10 services rejecten Bets waar `poolId !== null`:

```typescript
if (bet.poolId !== null) {
  throw new BetError(
    "BET_INVALID_STATUS",
    "Pool-attached bets settle via match result (PROMPT_12), not propose/confirm",
    409,
  );
}
```

Pre-check in `proposeResult` Step 4 (vóór de claim insert). `confirmResult` heeft de check niet expliciet nodig: een pool-attached bet kan nooit in RESULT_PROPOSED komen omdat propose hem zou afgewezen hebben. Defense-in-depth toch toevoegen — zelfde guard.

**ADR-0003 §2 verantwoordelijkheid:** "Per-match settlement flow: pool creator submits `(winnerSide, optional proof bundle)` → all Bets on the Match transition to SETTLED". Dit is een aparte flow die in P12 wordt geïmplementeerd. P10 dekt alleen het stand-alone P2P pad.

**Geen aparte error-code voor "pool-attached":** `BET_INVALID_STATUS` met duidelijke message volstaat. Alternatief `BET_POOL_ATTACHED_INVALID_OPERATION` zou een 11e statusbit zijn voor weinig winst.

---

### 9. `winnerId` lifecycle door alle statussen heen

| Status | `winnerId` waarde | Bron |
|---|---|---|
| DRAFT, OPEN, ACTIVE | `null` | createBet/acceptBet zetten 't niet |
| RESULT_PROPOSED | `claim.claimedWinnerId` (preliminary) | proposeResult zet bij status-update |
| AWAITING_CONFIRMATION | onveranderd (= preliminary value) | confirmResult update niet expliciet |
| SETTLED (via confirm-happy-path) | onveranderd (preliminary werd definitief bevestigd) | settleBet checkt via `winnerId` parameter |
| DISPUTED | onveranderd (preliminary, kan admin-override krijgen in P13) | confirmResult-DISAGREE update niet |
| CANCELLED, EXPIRED | `null` | cancelBet/expiry-cron zet niet |
| VOID | `null` | dispute → VOID resolution overschrijft naar null |

**Reden voor "preliminary winner blijft op DISPUTED":** geeft P13 een startpunt. Admin reads `bet.winnerId` als "wat de eerste claim zei" en kan vergelijken met het tegen-claim in `BetParticipantConfirmation.claimedWinnerId`. Als admin het oorspronkelijke claim bevestigt, geen winnerId-update nodig. Als admin tegenstelling kiest, override.

---

### 10. Export `lockBet` uit `service.ts`

P09 maakte `lockBet` module-private. P10's `settleBet` helper (en later P13) heeft hem nodig.

**Edit:**
```typescript
// src/lib/bets/service.ts — verwijder de niet-export prefix:
export async function lockBet(tx: TxClient, betId: string): Promise<{ id: string }> {
  /* ongewijzigde body */
}
```

**Waarom export ipv. dupliceren in settlement.ts:** DRY + één canonieke `FOR UPDATE` query op `bets` tabel. Zie regel #3 uit `feedback_zentrix_rules.md`: "no duplicate code".

**Waarom niet move naar `src/lib/bets/internal.ts`:** zou een nieuw bestand zijn alleen voor één helper. Behoud-in-service.ts is minimaal-invasief. Future refactor kan internal.ts maken als meer helpers ontstaan.

---

### 11. `settleBet` placement in `src/lib/bets/settlement.ts` (apart bestand)

Settlement-logica leeft NIET inline in `service.ts`. Aparte file:

- `src/lib/bets/settlement.ts` — `settleBet` helper, exports `SettleBetInput` + `settleBet`.
- Imports: `recordTransaction`, `getUserAccount`, `getTreasuryAccount` uit `@/lib/ledger`; `applyBps`, `FEES` uit `@/lib/fees`; `getOrCreateBetEscrowAccount` uit `./escrow`; `BetError` uit `./errors`; `lockBet` uit `./service`.

**Waarom apart bestand:** P13 dispute-service zal `settleBet` reuse. `service.ts` zou anders een hub worden voor alle bet-related code; settlement-laag heeft genoeg eigen context (fee-math, treasury, multi-line ledger transaction) om eigen file te krijgen.

**Geen `index.ts` re-export in `src/lib/bets/`:** P09 had geen index.ts; consistente import-paden via `@/lib/bets/service`, `@/lib/bets/settlement`, etc. Future refactor naar barrel-file is optioneel.

---

### 12. Geen `wrapTriggerError` in P10 — geen bet-inserts

`bets_creator_cannot_bet_on_own_pool_match` trigger fired alleen op INSERT/UPDATE met poolId set. P10 services UPDATEN bets maar veranderen `poolId` niet, dus de trigger fired niet voor onze updates.

Controle: trigger SQL lokaal verifiëren — staat in migration `20260508140901_add_bet_schema_v1/migration.sql`. De trigger checkt `NEW.pool_id IS NOT NULL AND ...`, maar onze updates zetten alleen status/version/winnerId/etc., niet pool_id. Geen triggerstrigger.

**Geen try/catch nodig rond updateMany calls.** Spaart leesbaarheid + matched precedent uit P09 (waar try/catch alleen op `bet.create` met poolId set zat).

---

### 13. Test structuur — 18 tests

Bestand: `src/__tests__/bets/bet-settlement.test.ts`. Pattern: `SUFFIX + PRIVY_PREFIX` cleanup; sequential test execution (vitest config `fileParallelism: false`).

#### proposeResult (5)

- **a. Happy path creator claimt zichzelf winnaar** — bet ACTIVE → RESULT_PROPOSED, BetResultClaim row, BetStateTransition row, `bet.winnerId === creator.id`, `bet.confirmDeadline` ~now+24h, `bet.resultStatus === "PROPOSED"`.
- **b. Happy path opponent claimt zichzelf winnaar** — symmetrisch met a; `bet.winnerId === opponent.id`.
- **c. Non-participant probeert claim** — derde user roept proposeResult op → `BET_NOT_PARTICIPANT` (403). Geen claim row, bet onveranderd.
- **d. Bet niet ACTIVE** — proposeResult op CANCELLED bet → `BET_INVALID_STATUS`. (Wordt voor cancel-pad gemaakt door createBet+cancelBet vooraf.)
- **e. Tweede claim van zelfde caller** — proposeResult roept twee keer met zelfde callerId (verschillende `idempotencyKey`s). Tweede call returnt **silent-success** met de bestaande claim (natural-idempotency via @@unique). Asserts: één enkele BetResultClaim row in DB, `result1.claim.id === result2.claim.id`.

#### confirmResult — CONFIRM_WINNER pad (5)

- **a. Happy path** — createAcceptedBet, creator claimt zichzelf, opponent confirmeert → bet SETTLED, ledger transaction met 2 lines (SETTLEMENT_PAYOUT + FEE_COLLECTION), beide BetParticipants `hasConfirmed=true`, `bet.settledAt` gezet, `bet.resultStatus === "CONFIRMED"`.
- **b. Ledger math expliciet** — stake 50_000_000n (50 USDC) per kant, pot = 100_000_000n. Verwacht: `winnerPayout = 98_000_000n`, `feeUnits = 2_000_000n`. Asserts: winner balance steeg met 98_000_000n, treasury balance steeg met 2_000_000n, escrow balance daalde naar 0n.
- **c. Replay van confirm met zelfde idempotencyKey** — eerste call settles. Tweede call met zelfde key returnt **silent-success** via natural-DB-state (existing BetParticipantConfirmation row). Asserts: één enkele BetParticipantConfirmation, één enkele `bet-settle:{betId}` LedgerTransaction, balances onveranderd na replay.
- **d. Claimant confirmeert zichzelf** — creator claimt + creator probeert te confirmeren → `BET_CONFIRM_BY_CLAIMANT` (403). Bet blijft RESULT_PROPOSED.
- **e. Geen bestaande claim** — direct confirmResult op een bet zonder voorafgaande proposeResult → `BET_INVALID_STATUS` (status is ACTIVE, niet RESULT_PROPOSED). De `BET_RESULT_CLAIM_NOT_FOUND` is technisch onbereikbaar via deze test omdat status-guard hem voor is — testen via een rauwe DB-mutatie die status forceert. Alternatief: skip de specifieke code-test als status-guard hem dekt; documenteer dat `BET_RESULT_CLAIM_NOT_FOUND` defensief is. **BESLISSING:** test #e roept met status forced via `tx.bet.update` om RESULT_PROPOSED te krijgen zonder een claim te insertren, en assertt dan `BET_RESULT_CLAIM_NOT_FOUND`. Defense-in-depth coverage.

#### confirmResult — DISAGREE pad (3)

- **a. Happy path** — creator claimt zichzelf, opponent disagreet met counter-claim (opponent als winner) → bet DISPUTED, `bet.resultStatus === "DISPUTED"`, BetParticipantConfirmation met `decision: "DISAGREE"` + `claimedWinnerId === opponent.id`. Geen ledger movement (escrow balance onveranderd).
- **b. DISAGREE zonder claimedWinnerId** — opponent disagreet maar laat `claimedWinnerId` weg → `BET_INVALID_INPUT`.
- **c. DISAGREE met zelfde winner als originele claim** — opponent disagreet maar set `claimedWinnerId` op zelfde value als claim → `BET_INVALID_INPUT` ("DISAGREE met zelfde winner = functional equivalent van CONFIRM").

#### Settlement edge cases (5)

- **a. Pool-attached bet rejected** — createPool + createMatch + createAcceptedBet met poolId+matchId, dan proposeResult → `BET_INVALID_STATUS` met message containing "pool-attached bets settle via match result".
- **b. Settled bet kan niet opnieuw geclaimt** — settle een bet, dan proposeResult op zelfde bet → `BET_INVALID_STATUS`.
- **c. Cancelled bet kan niet geclaimt** — cancelBet (DRAFT-pad) of een bet die later CANCELLED werd, dan proposeResult → `BET_INVALID_STATUS`.
- **d. Race: parallel proposeResult van beide users** — beide creators+opponent roepen tegelijk proposeResult met verschillende `claimedWinnerId`. Met FOR UPDATE: één wint, ander krijgt **of** `BET_INVALID_STATUS` (status nu RESULT_PROPOSED) **of** `BET_RESULT_ALREADY_CLAIMED` (zou alleen kunnen als zelfde caller race-d, niet relevant hier). Test asserteert: precies één BetResultClaim, één van beide met expected error.
- **e. confirmDeadline voorbij** — proposeResult, dan handmatig `tx.bet.update({confirmDeadline: <past>})`, dan confirmResult → `BET_DEADLINE_PASSED`.

#### Test infrastructure helpers

```typescript
const SUFFIX = `bet-settlement-${Date.now()}`;
const PRIVY_PREFIX = `bs-${SUFFIX}-`;
const testUserIds: string[] = [];

async function makeUser(label: string, fundUnits: bigint = 200_000_000n) {
  /* identical pattern uit bet-lifecycle.test.ts */
}

async function createAcceptedBet(creator: User, opponent: User, stake: bigint = 50_000_000n): Promise<Bet> {
  // Wraps createBet + acceptBet to produce ACTIVE bet for tests that
  // start with assumption that bet is already accepted.
  const created = await createBet({
    creatorId: creator.id, creatorSide: "A", stakeUnits: stake,
    expiresInHours: 24, idempotencyKey: crypto.randomUUID(),
  });
  const accepted = await acceptBet({
    opponentUserId: opponent.id,
    inviteToken: created.inviteToken!,
    idempotencyKey: crypto.randomUUID(),
  });
  return accepted.bet;
}

async function userBalance(userId: string): Promise<bigint> { /* same als P09 tests */ }
async function escrowBalance(betId: string): Promise<bigint> { /* same */ }
async function treasuryBalance(): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: "treasury" }
  });
  return acct?.balanceUnits ?? 0n;
}
```

**Cleanup volgorde (afterAll + beforeAll):**
```text
betStateTransition → betParticipantConfirmation → betResultClaim
  → betParticipant → betInvite → bet
  → matchEvidence → match → pool
  → ledgerEntry → ledgerTransaction
  → financialAccount (waar userId in testUserIds OR scopeKey starts with "bet:")
  → user (waar privyId starts with PRIVY_PREFIX)
```

**Treasury balance NIET meegeschoond** — singleton, leeft over tussen test-files. Tests asserteren delta's (niet absolute waardes).

---

### 14. Status-graph overzicht voor visuele referentie

```text
          createBet
              │
   ┌──────────┴──────────────┐
   │ DRAFT (transient)       │  cancelBet (P09)
   │     │ same tx           │       ↓
   │     ▼                   │   CANCELLED
   │   OPEN ─────────────────┼───→ CANCELLED
   │     │ acceptBet         │
   │     ▼                   │
   │   ACTIVE ───────────────┼───→ EXPIRED (P15 cron)
   │     │ proposeResult     │
   │     ▼                   │
   │ RESULT_PROPOSED ────────┼───→ DISPUTED  (DISAGREE)
   │     │ CONFIRM_WINNER    │       │
   │     │  + settleBet      │       │ P13
   │     ▼                   │       ▼
   │   SETTLED ◄─────────────┴── settleBet (dispute-resolved, P13)
   │                         │     of VOID (P13 admin → void)
   └─────────────────────────┘
```

**`AWAITING_CONFIRMATION` enum-waarde blijft in `BetStatus` (P08 schema)** maar wordt in P10 niet gebruikt. Reservering voor toekomstig multi-arbiter / multi-confirm scenario. PROOF_CONFIRM bilateraal gaat direct `RESULT_PROPOSED → SETTLED` (zie #4 Q2-resolved).

**Terminal statussen:** SETTLED, CANCELLED, EXPIRED, VOID. Geen verdere mutaties op terminal bets.

---

### 15. Idempotency key tabel (uitgebreid t.o.v. P09)

| Service | Ledger idempotencyKey | Caller-input mapping | Replay outcome |
|---|---|---|---|
| `createBet` (P09) | `bet-create:{idempotencyKey}` | UUID v4 caller-supplied | `inviteToken: null` |
| `acceptBet` (P09) | `bet-accept:{idempotencyKey}` | UUID v4 caller-supplied | silent success |
| `cancelBet` (P09) | `bet-cancel:{betId}` | deterministic | silent success |
| `proposeResult` (P10) | *n/a* (geen ledger movement) | UUID v4 caller-supplied | natural via `BetResultClaim @@unique` |
| `confirmResult` (P10) | *n/a* directly; transitive `bet-settle:{betId}` voor CONFIRM_WINNER | UUID v4 caller-supplied | natural via `BetParticipantConfirmation` lookup |
| `settleBet` helper | `bet-settle:{betId}` (confirm-path); P13-specific (dispute-path) | helper-internal | recordTransaction-replay safe |

---

### 16. Pre-flight + Post-flight overlap met P09

P10 hergebruikt het P09 service-test pattern volledig: `prisma.$transaction` wrap, `lockBet` helper, version-guard updateMany, BetStateTransition row per status mutatie, FEES + applyBps imports.

**Geen nieuwe pattern-introducties.** P10 is een additieve laag bovenop P09 — services die P09's lifecycle voortzetten naar settlement. Elke P10-test depends op P09 services voor setup (`createAcceptedBet` helper roept createBet + acceptBet).

---

### 17. Pool-attached propose-from-creator test scenario

Open Q4 zal vragen of pool-creator-zichzelf-claimt-winnaar (op pool-attached bet) een specifieke error moet geven of de generieke `BET_INVALID_STATUS` (zie #8). Voorgestelde implementatie: generieke status-error volstaat; geen aparte "pool creator" error voor settle-pad. Test #14 edge case **a** dekt dit door eerst de bet aan te maken (pool-attached) en daarna proposeResult te verwachten te falen.

---

## ── BEGIN PROMPT — uitvoering ──

You are extending zentrix met de Bet settlement services voor refactor fase 3. **De single most important rule:** geen geld muteren buiten `recordTransaction`. Geen hardcoded fee numbers. Alle status-mutaties via `prisma.$transaction` + `lockBet` + version-guard + BetStateTransition audit.

**Hard constraints:**
- `applyBps` + `FEES.PLATFORM_BPS` zijn de enige fee-bron in `settlement.ts`. Geen `200`, `2_000_000n`, of literal multipliers.
- `settleBet` is exported uit `settlement.ts` (P13 reuse).
- `lockBet` wordt geëxporteerd uit `service.ts` (was private in P09).
- Geen schema-mutaties, geen migrations.
- Test-fund users via direct `recordTransaction` (zelfde pattern als P09).

---

### Step 0 — Pre-flight

```bash
cd ~/zentrix
git status                                       # clean working tree
git log --oneline -1                             # c48927c (refactor-fase-2)
git tag -l | grep refactor-fase-2                # bestaat
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  70 passed (70)"

grep -E "@@unique\(\[betId, claimedById\]" prisma/schema.prisma   # 1 match
grep "PLATFORM_BPS" src/lib/fees.ts                              # PLATFORM_BPS: 200
grep "async function lockBet" src/lib/bets/service.ts            # 1 match
```

Stop bij rood.

---

### Step 1 — `src/lib/bets/errors.ts` uitbreiden

Voeg zes nieuwe codes toe aan de `BetErrorCode` union (zie #1). Geen nieuwe class. Geen breaking change voor P09-call-sites.

Sanity:
```bash
grep -cE "\"BET_(NOT_PARTICIPANT|RESULT_ALREADY_CLAIMED|RESULT_CLAIM_NOT_FOUND|CONFIRM_BY_CLAIMANT|DEADLINE_PASSED|SETTLEMENT_LEDGER_ERROR)\"" src/lib/bets/errors.ts
# Verwacht: 6
```

---

### Step 2 — `src/lib/bets/service.ts` — export `lockBet` + voeg `proposeResult` toe

1. Verwijder de `async` functie's privé-status door `export` toe te voegen aan `lockBet`.
2. Onder de bestaande exports, voeg toe:
   - `ProposeResultInput` interface (#2)
   - `ProposeResultResult` interface (#2)
   - `export async function proposeResult(input: ProposeResultInput): Promise<ProposeResultResult>` met flow per #2.

Sanity:
```bash
grep -c "^export async function (proposeResult|lockBet)" src/lib/bets/service.ts
# Verwacht: 2
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm typecheck
# exit 0
```

Bij WSL flake (segfault): `rm -f tsconfig.tsbuildinfo` en retry 1×.

---

### Step 3 — `src/lib/bets/service.ts` — voeg `confirmResult` toe (beide paden)

Voeg toe:
- `ConfirmResultInput` (#3) + `ConfirmResultResult`.
- `export async function confirmResult(input: ConfirmResultInput): Promise<ConfirmResultResult>` met flow per #4 (CONFIRM_WINNER) + #5 (DISAGREE).

Helper-import uit `./settlement`: `import { settleBet } from "./settlement";` — Step 4 maakt dit bestand. Tijdelijk uitcommentariëren of stub-export tot na Step 4 als TS niet-strict klaagt.

Beter: Step 4 vóór Step 3 doen — het script maakt eerst settlement.ts, dan voegt confirmResult dat hem importeert.

**ORDERING UPDATE:** swap Step 3 ↔ Step 4. Settlement helper komt eerst.

---

### Step 4 — `src/lib/bets/settlement.ts` — `settleBet` helper

Maak nieuw bestand met `SettleBetInput` interface + `settleBet` async function per #6. Imports uit `@/lib/ledger` (recordTransaction, getUserAccount, lockAccount, getTreasuryAccount, TxClient), `@/lib/fees` (applyBps, FEES), `./escrow` (getOrCreateBetEscrowAccount), `./errors` (BetError).

Sanity:
```bash
grep -c "^export.*settleBet" src/lib/bets/settlement.ts
# Verwacht: 2 (function + interface)
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm typecheck
# exit 0
```

---

### Step 5 — Skip (re-purposed: confirmResult was Step 3, gedaan na Step 4)

Met de re-ordering: Step 4 = settlement.ts, Step 5 = confirmResult in service.ts (was Step 3).

---

### Step 6 — `src/__tests__/bets/bet-settlement.test.ts` — 18 tests

Schrijf 18 tests per #13, gegroepeerd in `describe` blocks per pad (proposeResult / confirmResult.CONFIRM_WINNER / confirmResult.DISAGREE / Settlement edge cases). Helpers (`makeUser`, `createAcceptedBet`, `userBalance`, `escrowBalance`, `treasuryBalance`) bovenaan. Cleanup-volgorde per #13.

**Volgorde van tests-schrijven** (sneller debuggen):
1. proposeResult happy creator + opponent.
2. proposeResult guards (NON_PARTICIPANT, INVALID_STATUS, ALREADY_CLAIMED).
3. Pool-attached reject (#14a edge).
4. confirmResult CONFIRM_WINNER happy + ledger-math.
5. confirmResult CONFIRM_WINNER replay.
6. confirmResult CONFIRM_WINNER guards (CLAIMANT, CLAIM_NOT_FOUND).
7. confirmResult DISAGREE happy + guards (no winnerId, same-winner).
8. Settled-bet rejects (b, c).
9. Race (#14d).
10. Deadline-passed (#14e).

Per groep:
```bash
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm vitest run src/__tests__/bets/bet-settlement.test.ts
```

Wacht volledig groen tot alle 18.

---

### Step 7 — Volledige validatie

```bash
rm -f tsconfig.tsbuildinfo
pnpm prisma format
pnpm prisma validate
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm typecheck
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test
# Verwacht totaal: 70 (baseline) + 18 (settlement) = 88 tests passed.
```

WSL flake-handling per P09 ervaring: 1× retry op `--max-semi-space-size=512` is meestal genoeg. Als typecheck herhaaldelijk segfault: check of een `$queryRaw<Generic>` template-literal generic type ergens is geslopen — gebruik `as Array<...>` cast pattern.

---

### Step 8 — Commit + tag + push

```bash
git add src/lib/bets/errors.ts src/lib/bets/service.ts src/lib/bets/settlement.ts \
        src/__tests__/bets/bet-settlement.test.ts

git status

git commit -m "$(cat <<'COMMIT_MSG'
feat(bets): settlement services proposeResult/confirmResult/settleBet (PROMPT_10, refactor fase 3)

Implementeert PROOF_CONFIRM settlement flow per ADR-0003 §1+3+5 en
REFACTOR_PLAN fase 3.

Services:
- proposeResult: ACTIVE -> RESULT_PROPOSED, BetResultClaim insert,
  confirmDeadline = now+24h, winnerId preliminary. Caller is creator
  of opponent. Natural-DB idempotency via @@unique([betId, claimedById]).
- confirmResult CONFIRM_WINNER: RESULT_PROPOSED -> SETTLED in zelfde
  tx via settleBet helper (geen AWAITING_CONFIRMATION intermediate
  state — die enum-waarde blijft gereserveerd voor toekomstig
  multi-arbiter scenario). Beide BetParticipants hasConfirmed=true.
- confirmResult DISAGREE: RESULT_PROPOSED -> DISPUTED. Geen ledger
  movement; dispute service in P13 handelt af.
- settleBet (helper): exported voor P13 reuse. potUnits=2*stake,
  feeUnits=applyBps(pot, FEES.PLATFORM_BPS), winnerPayout=pot-fee.
  recordTransaction met 2 lines: SETTLEMENT_PAYOUT + FEE_COLLECTION.
  fromStatus parameter (RESULT_PROPOSED | DISPUTED) supports beide
  PROOF_CONFIRM en dispute-resolution paden.

Errors uitgebreid (10 -> 16):
- BET_NOT_PARTICIPANT, BET_RESULT_ALREADY_CLAIMED,
  BET_RESULT_CLAIM_NOT_FOUND, BET_CONFIRM_BY_CLAIMANT,
  BET_DEADLINE_PASSED, BET_SETTLEMENT_LEDGER_ERROR.

Pool-attached bets expliciet geweigerd in proposeResult (status guard
"pool-attached bets settle via match result" — P12 scope).

Refactor: lockBet helper geexporteerd uit service.ts voor settlement.ts
reuse. Geen schema mutations, geen migrations.

Tests (18 nieuwe):
- proposeResult: happy creator/opponent, NON_PARTICIPANT, INVALID_STATUS,
  ALREADY_CLAIMED replay.
- confirmResult CONFIRM_WINNER: happy, ledger-math (50 USDC stake ->
  98 USDC payout + 2 USDC fee), replay, CLAIMANT, CLAIM_NOT_FOUND.
- confirmResult DISAGREE: happy, no-winnerId, same-winner.
- Edge: pool-attached reject, settled-rejects, cancelled-rejects, race,
  deadline-passed.

Test count: 70 -> 88.

Pre-PROMPT_11 (Pool lifecycle services).
Reference: ADR-0003 (e9fc0c5), REFACTOR_PLAN (7fc4bbb), P08 schema (1618b27),
P09 lifecycle (c48927c), P10 spec (xxxxxxx).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT_MSG
)"

git tag refactor-fase-3
git log --oneline -5
git push origin main
git push origin refactor-fase-3
```

Replace `xxxxxxx` met de hash van de spec-commit (zal door uitvoeringssessie zelf opgehaald worden).

---

## Post-flight checks

```bash
# 1. Service exports kloppen
grep -E "^export (async )?function (proposeResult|confirmResult|lockBet)\b" src/lib/bets/service.ts
# Verwacht: 3 matches

grep -E "^export (async )?function settleBet\b" src/lib/bets/settlement.ts
# Verwacht: 1 match

# 2. Geen hardcoded fee numbers in settlement.ts
grep -nE "(200|2_000_000|10000)" src/lib/bets/settlement.ts | grep -v "PLATFORM_BPS\|applyBps\|//"
# Verwacht: niets (alle nummers via FEES./applyBps)

# 3. recordTransaction in settlement
grep -c "recordTransaction" src/lib/bets/settlement.ts
# Verwacht: 1 (settleBet)

# 4. Errors uitgebreid
grep -cE "\"BET_(NOT_PARTICIPANT|RESULT_ALREADY_CLAIMED|RESULT_CLAIM_NOT_FOUND|CONFIRM_BY_CLAIMANT|DEADLINE_PASSED|SETTLEMENT_LEDGER_ERROR)\"" src/lib/bets/errors.ts
# Verwacht: 6

# 5. BetStateTransition writes per service
grep -c "betStateTransition.create" src/lib/bets/service.ts
# Verwacht: minstens 5 (3 P09 + 2 P10: ACTIVE→RESULT_PROPOSED,
#                       RESULT_PROPOSED→DISPUTED)
grep -c "betStateTransition.create" src/lib/bets/settlement.ts
# Verwacht: 1 (RESULT_PROPOSED→SETTLED of DISPUTED→SETTLED)

# 6. Test count
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep "Tests"
# Verwacht: "Tests  88 passed (88)"

# 7. Ledger balanced — sample one settled bet
# Visual via prisma studio: één LedgerTransaction met refType=bet,
# refId=<betId>, totalDebits == totalCredits, twee LedgerEntry rows.
```

---

## Wat dit NIET doet

- **Geen pool-match settlement.** `submitMatchResult` (door pool creator) → automatic resolution van alle Bets op die Match komt **PROMPT_12**.
- **Geen disputes.** `openDispute`, `resolveDispute`, deposit-lock, admin-override van `winnerId` komen **PROMPT_13**.
- **Geen auto-settle cron.** Bets die in `RESULT_PROPOSED` blijven en `confirmDeadline` voorbij zijn worden niet automatisch geSETTLED in P10. Komt **PROMPT_15**.
- **Geen reputation updates.** `UserReputation` wordt niet aangeraakt bij settle. Komt **PROMPT_14**.
- **Geen circuit-breaker check.** `assertCircuitBreakerHealthy("bets")` blijft uitgesteld naar **PROMPT_15** (consistent met P09 beslissing).
- **Geen HTTP routes.** `POST /api/bets/:id/result/propose`, `POST /api/bets/:id/result/confirm` komen **PROMPT_16** met `withIdempotency` HTTP-laag wrapper.
- **Geen UI.** Komt P17+.
- **Geen multi-claim arbitration.** P10 is bilateraal (creator + opponent). 3+ claims is niet relevant want 1v1 max 2 participants.
- **Geen schema-aanpassingen.** Geen `@@unique([betId, userId])` op `BetParticipantConfirmation` toegevoegd in P10 (zie open Q3). Service-laag guard volstaat.
- **Geen seed data.** Geen `prisma/seed.ts` aanpassingen. Treasury account wordt al geseed in P07.
- **Geen invariant-check uitbreidingen.** P07 recon dekt ledger-balanced; bet-specific invariants (per-bet escrow_in == winner_out + treasury_fee) komen **PROMPT_15**.

---

## Volgende stap

Na user-akkoord op deze spec:
- **Stop voor review.** User leest dit document en geeft groen licht of correcties.
- **Daarna uitvoeren** in een latere Claude Code sessie via Steps 0-8 (let op re-ordering: Step 4 settlement.ts vóór confirmResult in service.ts).
- Bij groen Step 7: fase 3 commit + tag + push, dan PROMPT_11 spec schrijven (Pool lifecycle services).

---

## Beslissingen op open questions

Vier punten besproken; alle vier vastgelegd op 2026-05-08.

### Q1 — Idempotency strategie: natural-DB-state (AKKOORD)

`proposeResult` replay-detection via `BetResultClaim @@unique([betId, claimedById])` lookup. `confirmResult` DISAGREE via `BetParticipantConfirmation` lookup op `(betId, userId)`. `confirmResult` CONFIRM_WINNER via existing `bet-settle:{betId}` LedgerTransaction (transitive — settle wrote dat record). Caller-supplied `idempotencyKey` is form-validated (UUID v4) maar wordt niet voor lookup gebruikt — toekomstige P16 HTTP-wrapper zal hem benutten.

Trade-off: twee callers die voor zelfde caller+bet met verschillende `idempotencyKey`s propose-callen krijgen beide de eerste claim terug — natural-state-uniqueness wordt beschermd, niet caller-key-uniqueness. P16 HTTP-wrapper voegt de key-laag toe.

### Q2 — Direct `RESULT_PROPOSED → SETTLED` ipv intermediate `AWAITING_CONFIRMATION` (WIJZIGING)

Eerdere voorstel was twee status-transitions in CONFIRM_WINNER pad. **Vervangen door:** één directe transitie `RESULT_PROPOSED → SETTLED` in `settleBet`. `AWAITING_CONFIRMATION` blijft in de `BetStatus` enum (geen schema-mutatie) maar wordt door P10 niet gebruikt — gereserveerd voor toekomstig multi-arbiter scenario.

Spec impact: Beslissing #4 (CONFIRM_WINNER pad), #6 (settleBet helper signature `fromStatus: "RESULT_PROPOSED" | "DISPUTED"`), #14 (status graph), post-flight check #5, en commit-message zijn aangepast. Eén status-update, één BetStateTransition row in `settlement.ts` — minder churn in de hot path.

### Q3 — `BetParticipantConfirmation` service-laag guard, geen schema migration (AKKOORD)

P10 ships zonder schema-mutatie. Service-laag in `confirmResult` checkt expliciet voor existing confirmation row WHERE `betId AND userId` — replay returnt silent-success. Risico van rauwe SQL insert die de guard omzeilt is geaccepteerd: production loopt via service-routes, en de BetStateTransition log zou een dubbele confirmation duidelijk maken bij audit. Eventuele `@@unique([betId, userId])` migration kan in een later schema-cleanup commit worden meegenomen.

### Q4 — Pool-attached bet → `BET_INVALID_STATUS` met explicit message (AKKOORD)

Pool-attached bets worden in `proposeResult` (en defensief in `confirmResult`) afgewezen met `BetError("BET_INVALID_STATUS", "pool-attached bets settle via match result (PROMPT_12), not propose/confirm", 409)`. Geen nieuwe error-code — vermijdt code-bloat voor één edge case. Frontend kan op de message-string parsen of de `bet.poolId !== null` zelf checken om specifieke UI te tonen.

---

Spec is uitvoeringsklaar. Wachten op final akkoord voor Step 0 start.
