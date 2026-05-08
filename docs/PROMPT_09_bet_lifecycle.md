# PROMPT_09 — Bet lifecycle services (1v1 P2P)

**Refactor fase 2 deliverable.** Eerste service-laag stap na P08 schema, conform [ADR-0003](./ADR-0003-1v1-with-tournament-pools.md) §1, §5, §6 en [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) §4-5.

---

## Doel

Implementeer de drie pre-settlement lifecycle services voor 1v1 P2P bets:

- `createBet` — creator funds een 1v1 wager, bet promoveert van DRAFT → OPEN, invite-token wordt gegenereerd.
- `acceptBet` — opponent gebruikt invite-token, fundt zijn helft, bet promoveert OPEN → ACTIVE.
- `cancelBet` — creator trekt een nog-niet-geaccepteerde bet terug, full refund, bet → CANCELLED.

Alle drie moeten zowel **stand-alone** (`Bet.poolId = null`) als **pool-attached** (`Bet.poolId` + optioneel `Bet.matchId` set) werken. De DB-trigger uit P08 (`bets_creator_cannot_bet_on_own_pool_match`) blijft de laatste verdedigingslinie; service-laag pre-checked voor cleanere errors.

**Niet** in scope: settlement flow (`proposeResult`/`confirmResult`/`settle` → PROMPT_10), match-result-driven resolutie (PROMPT_12), disputes (PROMPT_13), expiry-cron (PROMPT_15), HTTP routes (PROMPT_16).

Test count target na P09: 52 → 70 (15 lifecycle + 3 safe-compare unit tests).

---

## Builds on

- **PROMPT_07** — `LedgerTransaction`, `LedgerEntry`, `FinancialAccount`, `lockAccount`, `recordTransaction`, `getUserAccount`, `betScopeKey`, idempotency-via-`LedgerTransaction.idempotencyKey @unique`. Allemaal canoniek, niet aangetast.
- **PROMPT_08** (commit `1618b27`, tag `refactor-fase-1`) — Bet, BetParticipant, BetInvite, BetStateTransition, Pool, Match modellen + trigger + CHECK constraint + `src/lib/fees.ts` met `FEES` constant + re-exported `applyBps`.
- **ADR-0003 §1** — 1v1 P2P fundament, status-graaf, version-based optimistic lock pattern.
- **ADR-0003 §5** — twee-laagse idempotency: ledger-laag (deterministische keys) is wat P09 implementeert. HTTP-laag wrapper (`withIdempotency`) komt in P16.
- **ADR-0003 §6** — `FOR UPDATE` op Bet row + sorted-id account locks + optimistic version als second-line guard.
- **Wager `bet-service.ts`** patterns — accept-flow met `FOR UPDATE` + version + `safeHashCompare`. Bron: `~/.claude/projects/-home-rapha-zentrix/memory/feedback_wager_patterns.md` regels 1-8 (1-op-1 over te nemen) en 1-9 (NIET over te nemen, met name regel 5: "Tweefase accept met manual rollback — alles in één `prisma.$transaction`").

---

## Files touched

| File | Mutatie | Omvang |
|---|---|---|
| `src/lib/bets/errors.ts` | NEW — `BetError` class + 10-code union, mirror van `WithdrawalError` pattern | ~30 regels |
| `src/lib/bets/escrow.ts` | NEW — `getOrCreateBetEscrowAccount(tx, betId)` race-safe helper | ~40 regels |
| `src/lib/crypto/safe-compare.ts` | NEW — `safeHashCompare()` wrapper rond `crypto.timingSafeEqual` | ~25 regels |
| `src/lib/bets/service.ts` | NEW — `createBet`, `acceptBet`, `cancelBet` exports | ~400 regels |
| `src/lib/env.ts` | EDIT — voeg `BET_MIN_USDC_UNITS` + `BET_MAX_USDC_UNITS` toe als optionele zod-velden met defaults | ~6 regels diff |
| `vitest.config.ts` | EDIT — voeg de twee nieuwe env-defaults toe aan `test.env` block voor CI determinisme | ~2 regels diff |
| `src/__tests__/bets/bet-lifecycle.test.ts` | NEW — 15 tests (5 createBet + 5 acceptBet + 4 cancelBet + 1 trigger) | ~600 regels |
| `src/__tests__/crypto/safe-compare.test.ts` | NEW — 3 unit tests (equal/unequal/length-mismatch) | ~30 regels |

Geen aanpassingen aan `prisma/schema.prisma` of nieuwe migrations. P09 leunt volledig op de schema die in P08 al gemigreerd is.

---

## Pre-flight verificatie

```bash
cd ~/zentrix

# 1. Branch + commit state
git status                                       # clean working tree
git log --oneline -1                             # 1618b27 (refactor-fase-1)
git tag -l | grep refactor-fase-1                # bestaat

# 2. Tests baseline = 52
NODE_OPTIONS="--max-old-space-size=12288" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  52 passed (52)"

# 3. Schema heeft Bet + BetParticipant + BetInvite + BetStateTransition
grep -cE "^model (Bet|BetParticipant|BetInvite|BetStateTransition)\b" prisma/schema.prisma
# Verwacht: 4

# 4. fees.ts module bestaat met FEES + applyBps
grep -E "FEES|applyBps" src/lib/fees.ts | head -5
# Verwacht: applyBps re-export + FEES constant

# 5. Money helper bevat applyBps origineel
grep -n "export function applyBps" src/lib/money/units.ts
# Verwacht: 1 match (regel 65)

# 6. Trigger aanwezig in DB (sanity check)
pnpm prisma db execute --schema=prisma/schema.prisma --stdin <<<"SELECT tgname FROM pg_trigger WHERE tgname = 'bets_creator_cannot_bet_on_own_pool_match';"
# Verwacht: 1 row

# 7. WSL heap-flag voor typecheck verplicht
export NODE_OPTIONS="--max-old-space-size=12288"
```

Stop bij rood op één van deze checks. Niet doorgaan zonder root cause.

---

## Beslissingen

17 numbered decisions die de spec verankeren. Format: **wat** (concrete shape) + **waarom** (rationale + Wager-pattern of ADR-bron).

### 1. `BetError` class — exact mirror van `WithdrawalError`

```typescript
// src/lib/bets/errors.ts
import "server-only";

export class BetError extends Error {
  constructor(
    public code: BetErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "BetError";
  }
}

export type BetErrorCode =
  | "BET_NOT_FOUND"                 // 404
  | "BET_NOT_OWNED_BY_CALLER"       // 403
  | "BET_INVALID_STATUS"            // 409
  | "BET_INVITE_INVALID"            // 404 — bad token of expired
  | "BET_ALREADY_ACCEPTED"          // 409
  | "BET_EXPIRED"                   // 409
  | "BET_INSUFFICIENT_BALANCE"      // 402
  | "BET_VERSION_MISMATCH"          // 409 — optimistic lock failure
  | "BET_INVALID_INPUT"             // 400 — validation failure
  | "BET_CREATOR_BETTING_OWN_POOL"; // 403 — DB trigger error mapped
```

**Waarom:** consistent met `WithdrawalError` (zie `src/lib/withdrawals/errors.ts`); één error class per bounded context. ADR-0003 §"What is new" lijst expliciet "`BetError` class + 10-code union". HTTP-statuscodes per code zoals in tabel; default 400 wanneer niet gespecificeerd.

**`BET_VERSION_MISMATCH` semantiek:** wordt alleen gegooid wanneer een tweede tx een Bet status-update probeert nadat de eerste al committed is binnen dezelfde service-call window. Voor de standaard accept-race wordt `FOR UPDATE` gebruikt (zie #11) — die serialiseerd, dus tweede caller ziet `BET_INVALID_STATUS`. Version-mismatch is een second-line guard voor het zeldzame geval dat de FOR UPDATE doorglipt (bv. handmatige SQL update buiten de service om).

---

### 2. `getOrCreateBetEscrowAccount(tx, betId)` — race-safe lazy create

```typescript
// src/lib/bets/escrow.ts
import "server-only";
import { Prisma } from "@prisma/client";
import { betScopeKey, type TxClient } from "@/lib/ledger";

/**
 * Race-safe lazy-create van het BET_ESCROW account voor een specifieke bet.
 * Pattern: findUnique → create → catch P2002 → re-findUnique.
 * Equivalent van Wager's pool escrow helper, maar scope=bet:{betId}.
 */
export async function getOrCreateBetEscrowAccount(tx: TxClient, betId: string) {
  const scopeKey = betScopeKey(betId);
  const existing = await tx.financialAccount.findUnique({ where: { scopeKey } });
  if (existing) return existing;
  try {
    return await tx.financialAccount.create({
      data: {
        accountType: "BET_ESCROW",
        scopeKey,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const after = await tx.financialAccount.findUnique({ where: { scopeKey } });
      if (after) return after;
    }
    throw e;
  }
}
```

**Waarom dit pattern:** standaard `getOrCreateXAccount` shape uit Wager + REFACTOR_PLAN §"Code behouden" (generaliseerd van pool-escrow naar bet-escrow). De catch op P2002 dekt de zeldzame race waar twee parallel transactions tegelijk het escrow proberen aan te maken; eerste wint, tweede vangt unique-violation en haalt de bestaande row op.

**ScopeKey conventie:** `betScopeKey(betId)` genereert `bet:{betId}` — al gedefinieerd in `src/lib/ledger/accounts.ts`. NIET inline samenstellen. NIET een nieuwe scope-key shape introduceren.

**Geen TREASURY/EXTERNAL helpers nodig in P09:** create/accept/cancel verplaatst geld alleen tussen user-account en bet-escrow. Treasury fees komen pas in `settle` (P10) wanneer `PLATFORM_BPS` toegepast wordt.

---

### 3. `safeHashCompare` — nieuw onder `src/lib/crypto/`

```typescript
// src/lib/crypto/safe-compare.ts
import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time hex-string compare. Gebruik voor invite-token verificatie
 * en alle andere "is deze hash gelijk aan opgeslagen hash"-checks waar
 * timing-leak een aanvalsvector zou zijn.
 *
 * Beide inputs moeten dezelfde lengte hebben — anders direct false (na
 * één buffer-allocatie, ook constant in caller-perspectief).
 */
export function safeHashCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
```

**Waarom hier:** ADR-0003 §7 ("Constant-time hash compare for invite tokens") + memory-pattern regel 11. Niet bestaand — `grep -rn "safeHashCompare\|timingSafeEqual" src/` levert 0 matches op moment van P09 start.

**Niet alleen `===` check:** invite-token verificatie is een security-pad. String-vergelijking met `===` lekt timing info per matchende byte; aanvaller kan over 1000+ requests de hash byte-voor-byte raden. `timingSafeEqual` voorkomt dit door altijd alle bytes te vergelijken.

**Test (zie #16, drie cases):** equal hashes → true; verschillende hashes met zelfde lengte → false; verschillende lengtes → false (zonder throw).

---

### 4. `createBet` input shape

```typescript
export interface CreateBetInput {
  creatorId: string;
  creatorSide: "A" | "B";
  stakeUnits: bigint;
  expiresInHours: number;
  poolId?: string;
  matchId?: string;
  idempotencyKey: string;
}

export interface CreateBetResult {
  bet: Bet;
  inviteToken: string | null; // null bij idempotent replay (zie #7)
}
```

**Velden:**
- `creatorSide` is `"A" | "B"` op de TS-type-laag — terwijl de DB-kolom een vrije `String` is (P08 #6 keuze). De service-laag enforced de twee-waarde restrictie; toekomstige multi-side bets zouden de type lifgen kunnen zonder DB-migratie.
- `stakeUnits` in BigInt USDC-units (1 USDC = 1_000_000n); R4 — geen Decimal of Number.
- `expiresInHours` int 1–720 — 1 uur tot 30 dagen. 24u is de default die UI suggereert; service heeft geen default, expliciet vereist.
- `poolId` optioneel; `matchId` alleen valide als `poolId` óók gezet is. CHECK constraint backup; service-laag returned `BET_INVALID_INPUT` voor cleanere error.
- `idempotencyKey` UUID v4 string, caller-supplied. NIET een random per call op service-niveau — caller (HTTP route in P16, of test) is verantwoordelijk. Hergebruikt voor `bet-create:{key}` ledger key (zie #6).

**Result `inviteToken`:** plain (unhashed) hex string, 64-char (sha256-input is 32 bytes), of `null` bij idempotent replay (zie #7). Wordt **alleen één keer** geretourneerd; DB stort uitsluitend de hash. Caller stuurt de plain-token naar opponent via een out-of-band kanaal en herkent een replay aan `inviteToken === null`.

---

### 5. `createBet` validatie volgorde

Service-laag valideert vóór elke DB-call. Order matters: cheapste checks eerst, DB-roundtrips laatst.

1. **`idempotencyKey`** matcht UUID v4 regex `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`. Bij mismatch: `BET_INVALID_INPUT`.
2. **`creatorSide`** is `"A"` of `"B"`. Anders: `BET_INVALID_INPUT`.
3. **`stakeUnits`** is BigInt > 0n. Vergelijken met `getEnv().BET_MIN_USDC_UNITS` (default 1_000_000n) en `BET_MAX_USDC_UNITS` (default 10_000_000_000n). Buiten range: `BET_INVALID_INPUT`.
4. **`expiresInHours`** is int in `[1, 720]`. Anders: `BET_INVALID_INPUT`.
5. **`matchId set ⇒ poolId set`** — anders `BET_INVALID_INPUT`. (CHECK constraint vangt het ook, maar onze error is leesbaarder dan `P0001` SQL-state.)
6. **(Async) `poolId` set:** `tx.pool.findUnique({where: {id: poolId}})`. Als `null` → `BET_INVALID_INPUT` met message `"Pool not found"`. Als `pool.status !== "OPEN"` → `BET_INVALID_STATUS` met message `"Pool not accepting bets (status=${status})"`.
7. **(Async) `matchId` set:** `tx.match.findUnique({where: {id: matchId}})`. Als `null` of `match.poolId !== poolId` → `BET_INVALID_INPUT`. Als `match.status !== "SCHEDULED"` → `BET_INVALID_STATUS`.

**Service-laag pre-check op trigger** (laatste guard pre-DB-write): als `poolId` set en `pool.createdById === creatorId`, gooi `BET_CREATOR_BETTING_OWN_POOL` direct. De DB-trigger blijft de hard guard, maar throwen-vanuit-service geeft de gebruiker een specifieke error met de juiste statusCode (403, niet de gegeneraliseerde 500 die een uncaught Postgres exception zou opleveren).

---

### 6. `createBet` flow (in `prisma.$transaction`)

```text
1. Pre-flight validatie (zie #5).
2. Genereer betId via crypto.randomUUID() — VÓÓR de tx, want we hebben hem nodig
   voor de escrow scopeKey en de ledger idempotency key.
3. Genereer plain inviteToken via crypto.randomBytes(32).toString("hex") — 64
   hex chars. Hash via createHash("sha256").update(token).digest("hex") → tokenHash.
4. prisma.$transaction(async (tx) => {
     // a. Idempotency short-circuit op create-niveau:
     const existingTx = await tx.ledgerTransaction.findUnique({
       where: { idempotencyKey: `bet-create:${idempotencyKey}` }
     });
     if (existingTx) {
       // Caller doet replay van een bet die we al gemaakt hebben.
       // Vind de Bet via refType='bet' + refId=<betId>.
       const replayedBet = await tx.bet.findFirst({
         where: { id: existingTx.refId! }
       });
       if (!replayedBet) throw new Error("Idempotency key bound to missing bet");
       // Plain token leeft niet meer (alleen de hash); return null
       // zodat caller replay expliciet kan herkennen (zie #7).
       return { bet: replayedBet, inviteToken: null };
     }

     // b. Pool/Match async validatie (zie #5 stappen 6-7).
     // c. SELECT FOR UPDATE op creator's user account, balance check.
     const userAcct = await getUserAccount(tx, creatorId);
     const locked = await lockAccount(tx, userAcct.id);
     if (locked.balanceUnits < stakeUnits) {
       throw new BetError("BET_INSUFFICIENT_BALANCE", `Need ${stakeUnits} units, have ${locked.balanceUnits}`, 402);
     }

     // d. Insert Bet (status DRAFT, version 0, expiresAt computed).
     const bet = await tx.bet.create({
       data: {
         id: betId,                 // ← deterministische ID
         createdById: creatorId,
         creatorSide,
         stakeUnits,
         status: "DRAFT",
         settlementMode: "PROOF_CONFIRM",
         resultStatus: "PENDING",
         version: 0,
         expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000),
         poolId: poolId ?? null,
         matchId: matchId ?? null,
       },
     });

     // e. Insert BetParticipant (creator's side).
     await tx.betParticipant.create({
       data: { betId: bet.id, userId: creatorId, side: creatorSide }
     });

     // f. Insert BetInvite met tokenHash + 24h expiry (configurable via expiresInHours).
     await tx.betInvite.create({
       data: {
         betId: bet.id,
         tokenHash,
         expiresAt: bet.expiresAt,  // invite expires when bet does
       }
     });

     // g. Get-or-create bet escrow account.
     const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);

     // h. recordTransaction: DEBIT user, CREDIT escrow.
     const ledgerResult = await recordTransaction({
       tx,
       idempotencyKey: `bet-create:${idempotencyKey}`,
       description: `Bet creator hold (bet=${bet.id})`,
       initiatorUserId: creatorId,
       refType: "bet",
       refId: bet.id,
       lines: [{
         debitAccountId: userAcct.id,
         creditAccountId: escrowAcct.id,
         amountUnits: stakeUnits,
         entryType: "ESCROW_LOCK",
         note: `bet-hold:${bet.id}:creator`,
       }],
     });

     // i. Insert BetStateTransition DRAFT → DRAFT (no-op marker for audit).
     //    Of skip — eerste echte transition is DRAFT → OPEN in stap j.
     //    BESLISSING: skip; transition rows leven alleen voor echte mutaties.

     // j. updateMany met version-guard: DRAFT → OPEN.
     const updated = await tx.bet.updateMany({
       where: { id: bet.id, version: 0, status: "DRAFT" },
       data: { status: "OPEN", version: 1, createdByLedgerTxId: ledgerResult.transaction.id },
     });
     if (updated.count !== 1) {
       throw new BetError("BET_VERSION_MISMATCH", `Bet ${bet.id} concurrently mutated`, 409);
     }

     // k. Insert BetStateTransition DRAFT → OPEN.
     await tx.betStateTransition.create({
       data: {
         betId: bet.id, fromStatus: "DRAFT", toStatus: "OPEN",
         actorId: creatorId, actorType: "USER",
         metadata: { ledgerTxId: ledgerResult.transaction.id },
       }
     });

     // l. Re-fetch bet voor return (status nu OPEN).
     const finalBet = await tx.bet.findUniqueOrThrow({ where: { id: bet.id } });
     return { bet: finalBet, inviteToken };
   });
```

**Waarom DRAFT → OPEN in dezelfde tx:** Wager schrijft eerst DRAFT, doet dan in een aparte tx de hold, en bij hold-failure rolt de DRAFT terug. Dit is de "tweefase accept met manual rollback" die in `feedback_wager_patterns.md` regel 5 expliciet als NIET-overnemen is gemarkeerd. Zentrix doet alles in één `prisma.$transaction` — bij failure rolt Postgres alles terug, geen compensating writes nodig.

**Waarom `updateMany` met version-guard:** standard Wager pattern. `update({where: {id, version: N}})` werkt niet met Prisma — de generated query mist de version-condition. `updateMany` met composite where + count-check is de canoniek correcte vorm.

**`createdByLedgerTxId`** wordt gevuld in stap j — audit-link van de DRAFT-naar-OPEN transitie naar de bijbehorende ledger transactie.

---

### 7. Idempotency-replay van `createBet` — return `inviteToken: null`

Een replay van `bet-create:{idempotencyKey}` returnt de bestaande Bet met `inviteToken: null`. De plain token leeft alleen één keer (security: niet opslaan); replay heeft die niet meer beschikbaar, dus expliciet `null` ipv. lege string of error.

```typescript
// Eerste call:
const result1 = await createBet({ ..., idempotencyKey: "abc" });
// → { bet: <new>, inviteToken: "<64-hex-chars>" }

// Replay (zelfde key, alle inputs identiek):
const result2 = await createBet({ ..., idempotencyKey: "abc" });
// → { bet: <zelfde id als result1.bet>, inviteToken: null }
```

**Caller herkent replay aan `inviteToken === null`.** Geen exception-handling pad nodig; replay is een legitieme uitkomst, geen fout. Caller die de invite-URL wil bouwen kan op `null` checken en de bestaande bet ophalen / desgewenst een fresh `idempotencyKey` gebruiken voor een nieuwe bet.

**Waarom expliciet `null` ipv. lege string `""`:** lege string is dubbelzinnig — kan ook duiden op een bug in token-generatie. `null` is in TypeScript de canonieke "expliciet afwezig"-waarde en dwingt de caller om er expliciet op te checken (geen `if (token)` truthy-coincidence).

**Waarom geen 409-error:** de tx is al committed op de eerste call; er is geen fout-conditie. Een error zou caller dwingen tot try/catch waar geen falen-pad is. Replay-with-null is type-safe en symmetrisch met `acceptBet`/`cancelBet` patterns (zie #9, #10) waar replay óók silent-correct werkt.

**`acceptBet` en `cancelBet` mogen ook replayen** (zie #9, #10) — die hebben geen one-shot secret in hun output, dus replayed-detection via output-shape is daar niet nodig.

---

### 8. `acceptBet` input + flow

```typescript
export interface AcceptBetInput {
  opponentUserId: string;
  inviteToken: string;       // plain text from creator
  idempotencyKey: string;
}

export interface AcceptBetResult {
  bet: Bet;
}
```

Flow (in `prisma.$transaction`):

```text
1. Validate idempotencyKey UUIDv4 format.
2. Validate inviteToken is 64 hex chars (regex /^[0-9a-f]{64}$/).
   Anders: BET_INVITE_INVALID (404).
3. Hash de plain token: tokenHash = sha256(inviteToken).
4. Idempotency short-circuit: zoek LedgerTransaction WHERE
   idempotencyKey = `bet-accept:${idempotencyKey}`.
   Als gevonden: re-fetch Bet via refId, return { bet }.

5. Zoek BetInvite WHERE tokenHash = computed-hash.
   findFirst — er is uniqueness op tokenHash, maar findFirst is robuust.
   Geen match: BET_INVITE_INVALID (404).

6. Constant-time compare met safeHashCompare(invite.tokenHash, computed)
   — al gefilterd via WHERE, maar belt-and-braces voor het geval iemand
   later de WHERE relaxt.

7. Guards op invite:
   - invite.usedAt !== null → BET_ALREADY_ACCEPTED (409).
   - invite.expiresAt < now → BET_INVITE_INVALID (404 met message "expired").

8. Lock Bet row: $queryRaw `SELECT id FROM bets WHERE id = $1 FOR UPDATE`.
   Re-fetch via tx.bet.findUniqueOrThrow.
   Guards op bet:
   - bet.status !== "OPEN" → BET_INVALID_STATUS (409).
   - bet.expiresAt < now → BET_EXPIRED (409).
   - bet.createdById === opponentUserId → BET_INVALID_INPUT (400, "self-accept blocked").
   - bet.opponentUserId !== null → BET_ALREADY_ACCEPTED (409). [defense-in-depth
     omdat invite.usedAt al gechecked is in stap 7.]

9. Pool-creator pre-check (defense-in-depth voor trigger):
   Als bet.poolId set: zoek pool, check pool.createdById !== opponentUserId.
   Anders: BET_CREATOR_BETTING_OWN_POOL (403).

10. Lock opponent's user account, balance check (zie #6 stap c).

11. acceptorSide bepalen: bet.creatorSide === "A" ? "B" : "A".

12. recordTransaction:
    idempotencyKey: `bet-accept:${idempotencyKey}` (de externe key)
    OF deterministisch: `bet-hold:${bet.id}:opponent`.
    BESLISSING: gebruik `bet-hold:${bet.id}:opponent` als ledger key.
    Reden: deterministisch per logische actie, voorkomt dat caller de
    HTTP-laag idempotencyKey kan hergebruiken om twee keer te debiteren
    op eenzelfde bet (zou theoretisch kunnen als hij verschillende keys
    voor accept-pogingen op dezelfde bet zou supplyen).
    refType: "bet", refId: bet.id.
    line: DEBIT opponent user, CREDIT bet escrow, ESCROW_LOCK type.

13. updateMany Bet: WHERE id, version: bet.version, status: "OPEN" →
    SET status: "ACTIVE", version: bet.version + 1, opponentUserId, acceptorSide.
    Count check: 1 → ok, 0 → BET_VERSION_MISMATCH.

14. Update BetInvite: usedAt = now, usedById = opponentUserId.

15. Insert BetParticipant (opponentUserId, acceptorSide).

16. Insert BetStateTransition OPEN → ACTIVE.

17. Re-fetch bet, return { bet }.
```

**Waarom `bet-hold:${betId}:opponent` als ledger key, niet `bet-accept:${key}`:** ledger-laag idempotency moet stabiel zijn over caller-supplied HTTP keys heen. Twee verschillende caller-supplied `idempotencyKey`s voor dezelfde bet moeten **dezelfde** ledger-write produceren (de hold), niet twee aparte. De HTTP-laag is verantwoordelijk voor "did this exact request already run" via de `bet-accept:{key}` lookup in stap 4 (vroeg-uitstijgen). De ledger-laag is verantwoordelijk voor "did this hold already happen" via `bet-hold:{betId}:opponent`.

**Race tussen twee acceptBet-calls op dezelfde bet:** `FOR UPDATE` in stap 8 serialiseerd. Tweede caller wacht, ziet status=ACTIVE, krijgt `BET_INVALID_STATUS`. De `BET_VERSION_MISMATCH` route is dood-pad onder normale FOR UPDATE; alleen relevant als FOR UPDATE per ongeluk weggehaald wordt (regression guard).

---

### 9. `acceptBet` idempotency-replay — silent-success

Replay van `bet-accept:{idempotencyKey}`: zoek LedgerTransaction met die key, vind de bet via `refId`, return de huidige bet-state. Geen extra werk.

**Waarom OK:** accept heeft geen one-shot output (geen plain token, geen secret). Replay is veilig en correct — de gebruiker krijgt de huidige toestand van zijn bet terug.

**Edge case:** wat als iemand replayt na een dispute waarin de bet status nu DISPUTED of SETTLED is? Geen probleem — we returnen de Bet "as-is" op het moment van replay. Caller weet dat het een replay was via een logische check op `bet.status`. We hoeven geen "stale" indicator te bieden.

---

### 10. `cancelBet` input + flow

```typescript
export interface CancelBetInput {
  userId: string;        // moet bet.createdById zijn
  betId: string;
  idempotencyKey: string;
}

export interface CancelBetResult {
  bet: Bet;
}
```

Flow (in `prisma.$transaction`):

```text
1. Validate idempotencyKey UUIDv4.
2. Idempotency short-circuit: zoek LedgerTransaction WHERE
   idempotencyKey = `bet-cancel:${betId}`.  // deterministic per bet
   Als gevonden: re-fetch bet, return.

3. Lock Bet row FOR UPDATE.
4. Re-fetch bet, asserteer:
   - bet.createdById === userId → anders BET_NOT_OWNED_BY_CALLER (403).
   - bet.status === "OPEN" of "DRAFT" → anders BET_INVALID_STATUS (409).

5. Lock creator user account én bet escrow account.

6. recordTransaction:
   idempotencyKey: `bet-cancel:${betId}`.
   description: `Bet cancellation refund (bet=${betId})`.
   line: DEBIT escrow → CREDIT user, full stakeUnits, ESCROW_RELEASE entryType.
   refType: "bet", refId: betId.

7. updateMany Bet:
   WHERE id, version: current, status IN ('OPEN', 'DRAFT')
   SET status: "CANCELLED", version: current + 1, cancelledAt: now.
   Count !== 1 → BET_VERSION_MISMATCH.

8. Insert BetStateTransition (current → CANCELLED, actor=creator, metadata={ledgerTxId}).

9. Re-fetch + return.
```

**`bet-cancel:{betId}` als ledger key (niet `:{idempotencyKey}`):** zelfde reden als #8 — een bet kan maar één keer gecancelled worden per definitie. Caller kan geen verschillende HTTP-keys hergebruiken voor multi-refund.

**Geen partial refund:** stake gaat 1-op-1 retour. Geen platform fee bij cancel — fee wordt alleen bij settlement geheven (FEES.PLATFORM_BPS, P10).

**Status `OPEN` én `DRAFT`:** `DRAFT` is een transient status binnen `createBet` — onder normaal gedrag is een Bet die "leeft" altijd al OPEN. Een DRAFT-Bet die toch buiten de createBet-tx ontstaat (bv. een aborted createBet die rolde back maar door bug niet geheel rolled back) kan via cancel weggepoetst worden. Defense-in-depth.

**Wat na ACTIVE?** Niet via `cancelBet`. ACTIVE bets refund-pad loopt via:
- expiry-cron (P15): als beide partijen geen result-claim doen vóór `bet.expiresAt`, automatische refund.
- dispute → VOID resolution (P13): admin beslist VOID, beide partijen krijgen stake terug.

`cancelBet` op een ACTIVE bet → `BET_INVALID_STATUS`. Test-coverage in #14b.

---

### 11. `FOR UPDATE` op Bet row — exact pattern

```typescript
// Inside service.ts, helper function:
async function lockBet(tx: TxClient, betId: string): Promise<{ id: string }> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM bets WHERE id = ${betId} FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new BetError("BET_NOT_FOUND", `Bet ${betId} not found`, 404);
  }
  return { id: rows[0].id };
}
```

**Roep aan na idempotency-check, vóór re-fetch via `tx.bet.findUniqueOrThrow`.** Pattern: lock met raw query (Prisma's typed-API ondersteunt geen `FOR UPDATE`), daarna typed re-read voor de daadwerkelijke fields. ADR-0003 §6 + Wager `bet-service.ts:472, 845`.

**Waarom niet alleen optimistic-lock via version:** ADR-0003 §6 expliciet "Bet-row `FOR UPDATE` lock at start of every status-mutating tx". Pessimistic + optimistic samen — eerste serialiseerd, tweede vangt edge-cases. De combinatie is hoeksteen van Wager's correctheid onder load.

---

### 12. Trigger error mapping

De `bets_creator_cannot_bet_on_own_pool_match` trigger gooit een Postgres exception met message-pattern `'Pool creator cannot bet on own pool (pool_id=%, creator=%)'`. Prisma vangt dit als `Prisma.PrismaClientUnknownRequestError` of `PrismaClientKnownRequestError` met `code` `P0001` (raise_exception).

```typescript
try {
  // bet.create / bet.update binnen tx
} catch (e) {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    typeof e.message === "string" &&
    e.message.includes("Pool creator cannot bet on own pool")
  ) {
    throw new BetError("BET_CREATOR_BETTING_OWN_POOL", "Pool creator may not bet on own pool", 403);
  }
  throw e;
}
```

**Wrap rond elke `bet.create` of `bet.update` waar `poolId` set is.** Centraliseer in een helper `wrapTriggerError(fn)` om DRY te houden — zie service.ts skeleton in #15.

**Niet gerelied op `e.code === "P0001"`:** Prisma's generated error code mapping voor user-defined trigger raises is wisselend (`P0001`, of generic `P2010`). Match op de exception-message is robuuster. De service-laag pre-check (#5 stap eind) blijft de happy-path voor 99% — dit is alleen het defense-in-depth pad.

---

### 13. Idempotency keys — overzichtstabel

| Service | Ledger idempotencyKey | Caller-input mapping |
|---|---|---|
| `createBet` | `bet-create:${idempotencyKey}` | UUIDv4 caller-supplied; replay → 409 (zie #7) |
| `acceptBet` | `bet-hold:${betId}:opponent` | UUIDv4 caller-supplied; replay → silent success (zie #9) |
| `cancelBet` | `bet-cancel:${betId}` | UUIDv4 caller-supplied; replay → silent success |

**Conventie:** ledger keys zijn deterministisch per logische actie (bet × role × phase), HTTP keys zijn caller-supplied per request. Beide zijn `@unique`-enforced — eerste op `LedgerTransaction.idempotencyKey`, tweede op `IdempotencyKey.[userId, key]` (P16 wrapper, niet in P09).

**Geen P09-implementatie van HTTP-wrapper.** ADR-0003 §5: "HTTP layer ... wrapper `withIdempotency(key, opts, handler)`" komt in PROMPT_16 routes. Tests in P09 supplyen idempotencyKeys direct aan de service-functies.

---

### 14. Test structuur (15 tests target)

Bestand: `src/__tests__/bets/bet-lifecycle.test.ts`. Pattern: `SUFFIX + PRIVY_PREFIX` cleanup; sequential test execution gegarandeerd door vitest config `fileParallelism: false, maxWorkers: 1`.

#### createBet (5 tests)
- **a. Happy path stand-alone** — geen pool/match, status DRAFT → OPEN, BetParticipant aangemaakt met creatorSide, BetInvite met tokenHash, ledger transactie balanced (sum debit = sum credit = stake), creator account balance daalde met stake, bet escrow balance steeg met stake.
- **b. Happy path pool-attached** — Pool aangemaakt door user X, Bet aangemaakt door user Y (≠X) met `poolId` + `matchId`. Trigger niet getriggerd (Y is geen pool-creator). Bet.poolId en Bet.matchId correct gezet.
- **c. Insufficient balance** — creator heeft 1_000_000n, stake 5_000_000n → `BET_INSUFFICIENT_BALANCE`, geen bet aangemaakt, geen ledger transactie, balance ongewijzigd.
- **d. Stake out-of-range** — stake 100n (onder MIN) → `BET_INVALID_INPUT`. Stake 100_000_000_000n (boven MAX) → `BET_INVALID_INPUT`. Stake 0n → idem.
- **e. Idempotent replay** — twee `createBet` calls met dezelfde `idempotencyKey` (en alle andere identieke inputs). Eerste slaagt: `inviteToken` is een 64-char hex string. Tweede call returnt `{ bet: <zelfde id>, inviteToken: null }` (per #7 beslissing). Asserts: `result1.bet.id === result2.bet.id`, `typeof result1.inviteToken === "string"` met length 64, `result2.inviteToken === null`. Database-side: één Bet row, één BetInvite row, één LedgerTransaction met key `bet-create:{idempotencyKey}`.

#### acceptBet (5 tests)
- **a. Happy path** — createBet, dan acceptBet door andere user met juiste plain token. Status OPEN → ACTIVE, beide BetParticipants exists, opponentUserId + acceptorSide gezet, BetInvite.usedAt + usedById gezet, ledger heeft 2 transacties (creator hold + opponent hold), bet escrow balance = 2 × stake.
- **b. Bad invite token** — willekeurige 64-char hex string → `BET_INVITE_INVALID`. Bet status onveranderd. Geen ledger entry.
- **c. Expired invite** — createBet met `expiresInHours: 1`, simuleer time-skip via `tx.betInvite.update({expiresAt: <past>})`, accept → `BET_INVITE_INVALID` met message "expired".
- **d. Self-accept geblokkeerd** — creator probeert eigen bet te accepteren met eigen invite-token → `BET_INVALID_INPUT` met message "self-accept blocked".
- **e. Race: parallel accept × 2** — twee verschillende users proberen tegelijk te accepteren met **zelfde** invite-token. Beide krijgen aparte `idempotencyKey`. Vitest sequentialiseert intra-file, dus simuleer met handmatige `Promise.all` met `prisma.$transaction` per call. Verwacht: één succes (status=ACTIVE), één failure met `BET_INVALID_STATUS` (de tweede wacht op FOR UPDATE, ziet ACTIVE, gooit). Of `BET_ALREADY_ACCEPTED` als tweede tx kijkt naar invite.usedAt eerst — beide acceptable, test asserteer dat een van de twee is. Ledger transacties: exact 2 holds (creator + opponent-die-won).

#### cancelBet (4 tests)
- **a. Happy path OPEN** — createBet, cancelBet door creator. Status → CANCELLED, cancelledAt gezet, bet escrow → 0, creator balance hersteld.
- **b. Non-creator** — andere user dan creatorId roept cancelBet. → `BET_NOT_OWNED_BY_CALLER`. Bet status onveranderd.
- **c. ACTIVE bet** — createBet + acceptBet, dan cancelBet → `BET_INVALID_STATUS`. Bet blijft ACTIVE, beide stakes nog in escrow.
- **d. Idempotent replay** — twee `cancelBet` calls met dezelfde `idempotencyKey`. Tweede returnt zelfde bet zonder tweede refund. Ledger heeft één refund transactie.

#### Trigger (1 test)
- **a. Pool-creator self-bet** — Pool aangemaakt door user X, X probeert `createBet` met `poolId: pool.id, creatorId: X` → `BET_CREATOR_BETTING_OWN_POOL` (403). Geen bet aangemaakt. (Zelfs als opponentUserId óók X is — dat zou `bet.opponentUserId === bet.createdById` zijn maar trigger fired vóór die check.)

**Test-infrastructure helpers** in dezelfde file:

```typescript
const SUFFIX = `bet-lifecycle-${Date.now()}`;
const PRIVY_PREFIX = `bl-${SUFFIX}-`;

async function makeUser(label: string, fundUnits: bigint = 100_000_000n) {
  const user = await prisma.user.create({
    data: { privyId: `${PRIVY_PREFIX}${label}`, email: `${PRIVY_PREFIX}${label}@example.com` },
  });
  // Direct ledger funding — NIET via deposit flow (out of P09 scope).
  await prisma.$transaction(async (tx) => {
    const userAcct = await getUserAccount(tx, user.id);
    const externalAcct = await getExternalAccount(tx);
    await recordTransaction({
      tx,
      idempotencyKey: `test-fund:${user.id}`,
      description: `Test funding for ${user.privyId}`,
      initiatorUserId: user.id,
      refType: "test",
      refId: user.id,
      lines: [{
        debitAccountId: externalAcct.id,
        creditAccountId: userAcct.id,
        amountUnits: fundUnits,
        entryType: "DEPOSIT_CREDIT",
        note: "test-funding",
      }],
    });
  });
  return user;
}
```

**Teardown** (`afterAll`):
```typescript
await prisma.betStateTransition.deleteMany({});
await prisma.betParticipant.deleteMany({});
await prisma.betInvite.deleteMany({});
await prisma.bet.deleteMany({});
await prisma.match.deleteMany({});
await prisma.pool.deleteMany({});
await prisma.ledgerEntry.deleteMany({
  where: { transaction: { initiatorUserId: { in: testUserIds } } }
});
await prisma.ledgerTransaction.deleteMany({
  where: { initiatorUserId: { in: testUserIds } }
});
await prisma.financialAccount.deleteMany({
  where: { OR: [
    { userId: { in: testUserIds } },
    { scopeKey: { startsWith: `bet:` } }, // best-effort, kan stale rows raken
  ]}
});
await prisma.user.deleteMany({ where: { privyId: { startsWith: PRIVY_PREFIX } } });
```

**Cleanup volgorde:** kinderen voor ouders (FK constraints). `betStateTransition` heeft FK naar `bet`, `betParticipant` heeft FK naar `bet`, dus eerst die. `bet` heeft FK naar `pool` en `match`, dus `bet` voor `pool`/`match`. `ledgerEntry` heeft FK naar `ledgerTransaction`. `financialAccount` heeft geen kinderen onder zichzelf, maar `bet` heeft FK naar `financialAccount` via... eigenlijk nee, `bet.createdByLedgerTxId` is FK naar `ledgerTransaction`, niet account. Dus financialAccount kan na bet/ledger weg.

---

### 15. `service.ts` skeleton

```typescript
// src/lib/bets/service.ts
import "server-only";
import { Prisma, type Bet } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  recordTransaction,
  getUserAccount,
  lockAccount,
  type TxClient,
} from "@/lib/ledger";
import { getEnv } from "@/lib/env";
import { BetError } from "./errors";
import { getOrCreateBetEscrowAccount } from "./escrow";
import { safeHashCompare } from "@/lib/crypto/safe-compare";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_HEX = /^[0-9a-f]{64}$/;

export interface CreateBetInput { /* zie #4 */ }
export interface CreateBetResult { bet: Bet; inviteToken: string | null }
export interface AcceptBetInput { /* zie #8 */ }
export interface AcceptBetResult { bet: Bet }
export interface CancelBetInput { /* zie #10 */ }
export interface CancelBetResult { bet: Bet }

export async function createBet(input: CreateBetInput): Promise<CreateBetResult> { /* #5 + #6 */ }
export async function acceptBet(input: AcceptBetInput): Promise<AcceptBetResult> { /* #8 */ }
export async function cancelBet(input: CancelBetInput): Promise<CancelBetResult> { /* #10 */ }

// ── helpers ──────────────────────────────────────────────────────────

async function lockBet(tx: TxClient, betId: string) { /* #11 */ }

function wrapTriggerError<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      typeof e.message === "string" &&
      e.message.includes("Pool creator cannot bet on own pool")
    ) {
      throw new BetError("BET_CREATOR_BETTING_OWN_POOL", "Pool creator may not bet on own pool", 403);
    }
    throw e;
  });
}

function computeTokenHash(plainToken: string): string {
  return crypto.createHash("sha256").update(plainToken).digest("hex");
}
```

**Geen logging in `service.ts` voor MVP:** P09 services zijn pure functies. `pino` logging hooks komen in P16 routes (request-scoped). Lessons-from-Wager regel "no implicit logging in service-layer".

**Geen circuit-breaker check in P09:** ADR-0003 §7 beschrijft circuit-breaker als money-movement gate. P09's services zijn money-movement, dus eigenlijk zouden ze achter een `assertCircuitBreakerHealthy("bets")` moeten zitten. **Beslissing (Q1 resolved):** circuit-breaker integratie verschuift naar P15 invariants prompt — daar wordt de breaker-key `bets` toegevoegd én de assertions in services. P09 ships zonder breaker-check; P15 voegt ze toe in één commit.

---

### 16. `safeHashCompare` test (3 cases)

```typescript
// src/__tests__/crypto/safe-compare.test.ts
import { describe, expect, it } from "vitest";
import { safeHashCompare } from "@/lib/crypto/safe-compare";

describe("safeHashCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeHashCompare("abc123", "abc123")).toBe(true);
  });
  it("returns false for different strings of same length", () => {
    expect(safeHashCompare("abc123", "abc124")).toBe(false);
  });
  it("returns false for different lengths without throwing", () => {
    expect(safeHashCompare("abc", "abc1")).toBe(false);
  });
});
```

**Geen explicit timing-guarantee test:** Node's `timingSafeEqual` is verantwoordelijk voor de constant-time eigenschap; we testen alleen API-correctheid.

---

### 17. Env-vars uitbreiden

`src/lib/env.ts` zod-schema krijgt twee nieuwe optionele velden:

```typescript
BET_MIN_USDC_UNITS: z.coerce.bigint().default(1_000_000n),     // $1.00
BET_MAX_USDC_UNITS: z.coerce.bigint().default(10_000_000_000n), // $10,000.00
```

**`z.coerce.bigint()`:** zod 3.x supports BigInt coercion sinds 3.20. String env-input → BigInt. Test in vitest.config.ts:

```typescript
// vitest.config.ts test.env block — voeg toe:
BET_MIN_USDC_UNITS: "1000000",
BET_MAX_USDC_UNITS: "10000000000",
```

(Strings, want process.env values zijn strings; zod coerces.)

**Waarom hier en niet als constant in service.ts:** ADR-0003 §"Fees — uniform, single-source-of-truth" patroon: economische limieten zijn config, geen hardcoded constants. Dezelfde reden waarom `WITHDRAWAL_MIN_USDC` env-var is en niet hardcoded — operations team kan ze tunen zonder deploy.

**Niet via `fees.ts`:** `fees.ts` is voor BPS-rates en per-fee-type minimums (DISPUTE_DEPOSIT_MIN_USDC_UNITS). Bet stake limieten zijn geen "fee" — apart concept, hoort in env. Beslissing: niet de scope van `fees.ts` oprekken.

---

## ── BEGIN PROMPT — uitvoering ──

You are extending zentrix met de Bet lifecycle services voor refactor fase 2. **De single most important rule:** alle service-functies leven binnen `prisma.$transaction`, met `FOR UPDATE` op de bet-row en sorted-id account locks via `recordTransaction`. Geen tweefase patterns. Geen compensating writes. Tests verifiëren ledger-balanced + balance-correct + status-correct + idempotency-correct in dezelfde commit als de implementatie.

**Hard constraints:**
- Geen hardcoded fee-numbers of stake-limits in `service.ts`. Importeer uit `fees.ts` (post-MVP) of `getEnv()` (stake limits).
- Geen `applyBps` redefinitie. Importeer uit `@/lib/fees` (re-export route) of direct `@/lib/money/units`.
- Geen logging in `service.ts`. Errors throwen. Logging komt in P16 routes.
- Test-fund users via direct ledger insert (`recordTransaction` met `EXTERNAL → user`, `DEPOSIT_CREDIT` entryType), NIET via deposit-flow (`src/lib/deposits/`). Deposits zijn out-of-scope voor P09.
- Cleanup-volgorde in afterAll respecteert FK-constraints.

---

### Step 0 — Pre-flight

```bash
cd ~/zentrix
git status                                       # clean working tree
git log --oneline -1                             # 1618b27 (refactor-fase-1)
git tag -l | grep refactor-fase-1                # bestaat
export NODE_OPTIONS="--max-old-space-size=12288"
NODE_OPTIONS="--max-old-space-size=12288" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  52 passed (52)"
```

Stop bij rood. Check schema heeft alle P08-modellen (zie pre-flight checks 3-6 boven).

---

### Step 1 — `src/lib/bets/errors.ts`

Maak nieuw bestand met `BetError` class + `BetErrorCode` union per #1. Mirror `WithdrawalError` style.

Sanity:
```bash
grep -c "BetErrorCode" src/lib/bets/errors.ts   # 1
grep -c "BetError" src/lib/bets/errors.ts       # 2 (class + extends Error context)
```

---

### Step 2 — `src/lib/crypto/safe-compare.ts`

Maak nieuw bestand met `safeHashCompare` per #3. Maak ook test-bestand `src/__tests__/crypto/safe-compare.test.ts` per #16.

Validate:
```bash
NODE_OPTIONS="--max-old-space-size=12288" pnpm vitest run src/__tests__/crypto/safe-compare.test.ts
# Verwacht: "Tests  3 passed (3)"
```

Stop bij rood.

---

### Step 3 — `src/lib/bets/escrow.ts`

Maak nieuw bestand met `getOrCreateBetEscrowAccount(tx, betId)` per #2. Importeer `betScopeKey` + `TxClient` uit `@/lib/ledger`. Geen tests hier — escrow wordt covered door bet-lifecycle tests.

---

### Step 4 — Env uitbreiden

Edit `src/lib/env.ts`:
- Voeg `BET_MIN_USDC_UNITS` + `BET_MAX_USDC_UNITS` toe aan zod-schema per #17.
- Geen wijzigingen aan `getEnv()` zelf.

Edit `vitest.config.ts`:
- Voeg de twee env-vars toe aan `test.env` block met string-defaults.

Validate:
```bash
NODE_OPTIONS="--max-old-space-size=12288" pnpm vitest run src/__tests__/smoke/env.test.ts
# Verwacht: alle 3 baseline env-tests groen.
```

---

### Step 5 — `src/lib/bets/service.ts`

Implementeer in volgorde: helpers (`lockBet`, `wrapTriggerError`, `computeTokenHash`) eerst, dan `createBet`, dan `acceptBet`, dan `cancelBet`. Volg #4 + #5 + #6 voor createBet, #8 voor acceptBet, #10 voor cancelBet.

Sanity na elk service-functie skelet:
```bash
NODE_OPTIONS="--max-old-space-size=12288" pnpm typecheck
# Verwacht: exit 0, geen errors.
```

Stop bij typecheck-rood. Niet doorgaan met volgende functie.

---

### Step 6 — `src/__tests__/bets/bet-lifecycle.test.ts`

Schrijf 15 tests per #14, gegroepeerd in `describe` blocks per service. Helpers (`makeUser`, cleanup) bovenaan het bestand.

Volgorde van tests-schrijven (om sneller te kunnen debuggen):
1. createBet happy path stand-alone (#14a) → moet eerst werken.
2. createBet insufficient balance + invalid input + idempotent replay (#14c-e) → grenzen.
3. createBet pool-attached (#14b) → trigger-pad happy.
4. Trigger test (#14 trigger) → trigger-pad fail.
5. acceptBet happy path (#14a accept).
6. acceptBet fouten (#14b-d).
7. acceptBet race (#14e accept) — laatste, complex.
8. cancelBet happy + non-creator + ACTIVE + idempotent (#14a-d cancel).

Validate na elke groep:
```bash
NODE_OPTIONS="--max-old-space-size=12288" pnpm vitest run src/__tests__/bets/bet-lifecycle.test.ts
# Tussenresultaten OK — wacht volledige groen tot alle 15.
```

---

### Step 7 — Volledige validatie

```bash
rm -f tsconfig.tsbuildinfo
pnpm prisma format
pnpm prisma validate
NODE_OPTIONS="--max-old-space-size=12288" pnpm typecheck
NODE_OPTIONS="--max-old-space-size=12288" pnpm test
# Verwacht totaal: 52 (baseline) + 3 (safe-compare) + 15 (bet-lifecycle) = 70 tests passed.
```

Bij rood: stop, root cause vinden, niet door naar Step 8.

---

### Step 8 — Commit + tag + push

```bash
git add src/lib/bets/errors.ts \
        src/lib/bets/escrow.ts \
        src/lib/bets/service.ts \
        src/lib/crypto/safe-compare.ts \
        src/lib/env.ts \
        vitest.config.ts \
        src/__tests__/crypto/safe-compare.test.ts \
        src/__tests__/bets/bet-lifecycle.test.ts

git status

git commit -m "$(cat <<'COMMIT_MSG'
feat(bets): lifecycle services createBet/acceptBet/cancelBet (PROMPT_09, refactor fase 2)

Implementeert de drie pre-settlement services per ADR-0003 §1+5+6 en
REFACTOR_PLAN fase 2.

Services:
- createBet: DRAFT->OPEN promotie in één tx, creator-hold via
  recordTransaction (DEBIT user, CREDIT bet-escrow), invite-token gegenereerd
  en uitsluitend hash opgeslagen. UUID v4 caller-supplied idempotencyKey;
  replay returns 409 (plain token niet reconstrueerbaar).
- acceptBet: OPEN->ACTIVE met FOR UPDATE op bet-row, opponent-hold via
  bet-hold:{betId}:opponent ledger key, BetInvite usedAt+usedById gezet,
  acceptorSide automatisch tegenovergestelde van creatorSide. Replay
  silent-success.
- cancelBet: alleen OPEN/DRAFT bets, alleen creator. Full refund via
  ESCROW_RELEASE entry. Status -> CANCELLED, cancelledAt gezet. Replay
  silent-success.

Helpers:
- BetError class + 10-code union (mirror WithdrawalError)
- getOrCreateBetEscrowAccount(tx, betId) — race-safe lazy create met
  scopeKey bet:{betId}, BET_ESCROW account type.
- safeHashCompare via Node's timingSafeEqual — constant-time invite-token
  verificatie.

Patterns adopted (Wager-pattern memory regels 1-8):
- prisma.$transaction wrap rond elke service.
- FOR UPDATE op bet-row vóór elke status-mutatie.
- Optimistic version field als second-line guard.
- recordTransaction met sorted-id account locks (al bestaand uit P07).
- Caller-supplied deterministic ledger keys per logische actie.

Patterns NIET overgenomen:
- Tweefase accept met manual rollback (memory NIET-regel 5) — alles in
  één tx, Postgres rolt back op error.
- Per-line lock in recordTransaction — accounts upfront gelockt
  (al pattern uit P07).

Tests (15 nieuwe + 3 safe-compare):
- createBet: stand-alone happy, pool-attached happy, insufficient balance,
  out-of-range stake, idempotent replay.
- acceptBet: happy, bad token, expired invite, self-accept blocked,
  parallel-accept race.
- cancelBet: happy OPEN, non-creator forbidden, ACTIVE blocked, idempotent.
- Trigger: pool-creator-self-bet blocked.

Env additions:
- BET_MIN_USDC_UNITS (default 1_000_000n = $1)
- BET_MAX_USDC_UNITS (default 10_000_000_000n = $10000)
Beide z.coerce.bigint(); vitest config aangepast voor CI determinisme.

Test count: 52 -> 70.

Pre-PROMPT_10 (proposeResult/confirmResult/settle PROOF_CONFIRM flow).
Reference: ADR-0003 (e9fc0c5), REFACTOR_PLAN (7fc4bbb), P08 schema (1618b27).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT_MSG
)"

git tag refactor-fase-2
git log --oneline -5
git push origin main
git push origin refactor-fase-2
```

---

## Post-flight checks

```bash
# 1. Service exports kloppen
grep -E "^export (async )?function (createBet|acceptBet|cancelBet)\b" src/lib/bets/service.ts
# Verwacht: 3 matches

# 2. Geen hardcoded fee/stake numbers in service.ts
grep -nE "(200|1500|1_000_000|10_000_000_000)\b" src/lib/bets/service.ts
# Verwacht: ÉN niets, ÉN alleen via FEES./getEnv() referentie. Manuele review.

# 3. FOR UPDATE in service
grep -c "FOR UPDATE" src/lib/bets/service.ts
# Verwacht: minstens 1 (in lockBet helper)

# 4. recordTransaction gebruikt
grep -c "recordTransaction" src/lib/bets/service.ts
# Verwacht: minstens 3 (één per service)

# 5. BetStateTransition writes
grep -c "betStateTransition.create" src/lib/bets/service.ts
# Verwacht: minstens 3 (DRAFT->OPEN, OPEN->ACTIVE, ->CANCELLED)

# 6. Idempotency keys deterministisch
grep -nE "bet-create:|bet-hold:|bet-cancel:" src/lib/bets/service.ts
# Verwacht: 4+ matches (create, hold:creator, hold:opponent, cancel)

# 7. Test count
NODE_OPTIONS="--max-old-space-size=12288" pnpm test 2>&1 | grep "Tests"
# Verwacht: "Tests  70 passed (70)"

# 8. Ledger balanced invariant — sample 1 bet
# (visual inspect via pnpm prisma studio, optional)
```

---

## Wat dit NIET doet

- **Geen settlement.** `proposeResult`, `confirmResult`, `settle` (PROOF_CONFIRM end-to-end met platform-fee) komen in **PROMPT_10**.
- **Geen disputes.** `openDispute`, `resolveDispute`, dispute-deposit hold/release komen in **PROMPT_13**.
- **Geen pool lifecycle services.** `createPool`, `publishPool`, `closePool` komen in **PROMPT_11**.
- **Geen match-result submission.** `submitMatchResult` (door pool creator) → automatic bet resolution komt in **PROMPT_12**.
- **Geen HTTP routes.** `withIdempotency` HTTP-wrapper + `POST /api/bets`, `POST /api/bets/:id/accept`, `POST /api/bets/:id/cancel` komen in **PROMPT_16**.
- **Geen UI.** Komt in PROMPT_17+.
- **Geen UserReputation updates.** Schema staat klaar uit P08; logica (score recompute, tier transitions, dispute-rate calc) komt in **PROMPT_14**.
- **Geen expiry-cron.** Het automatisch markeren van OPEN-bets als EXPIRED na missed `expiresAt` komt in **PROMPT_15**. Tot die tijd blijven oude OPEN-bets staan met onaangeraakt escrow — dat is acceptable voor MVP-pre-launch.
- **Geen circuit-breaker check.** Bets-key wordt toegevoegd in PROMPT_15; service-laag krijgt dan `assertCircuitBreakerHealthy("bets")` toegevoegd. Tot die tijd vertrouwt P09 op de bestaande deposits/withdrawals breakers + invariant cron uit P07.
- **Geen invite-link URL building.** `inviteToken` is een hex string; URL-vorming (`/bets/:id/accept?token=...`) is een UI/route concern voor P16-17.
- **Geen rate-limiting.** Anti-spam, anti-abuse rate limits per user komen in P14 reputation prompt.
- **Geen seed data.** Geen `prisma/seed.ts` aanpassingen.

---

## Volgende stap

Na user-akkoord op deze spec:
- **Stop voor review.** User leest dit document en geeft groen licht of correcties.
- **Daarna uitvoeren** in een latere Claude Code sessie via Steps 0-8.
- Bij groen Step 7: fase 2 commit + tag + push, dan PROMPT_10 spec schrijven (bet settlement: proposeResult / confirmResult / settle).

---

## Beslissingen op open questions

Vier punten besproken; alle vier vastgelegd op 2026-05-08.

### Q1 — Circuit breaker: uitstel naar P15 (AKKOORD)

P09 ships **zonder** `assertCircuitBreakerHealthy("bets")` in de service-functies. De `bets` breaker-key + service-laag assertions worden in één commit toegevoegd in PROMPT_15. Risico tussen P09 en P15: services niet door breaker beschermd. Mitigatie: HTTP routes (P16) en UI (P17) komen pas na P15, dus services leven tot dan alleen in tests — geen productie-blootstelling.

### Q2 — `createBet` replay returnt `inviteToken: null` (WIJZIGING t.o.v. eerste voorstel)

Eerdere voorstel was 409-error op replay. **Vervangen door:** replay returnt `{ bet: <bestaande>, inviteToken: null }`. Caller herkent replay aan `inviteToken === null`. Reden voor wijziging: error-pad voegt try/catch toe waar geen fout-conditie is; expliciete `null` is type-safe en symmetrisch met `acceptBet`/`cancelBet` silent-success replays. Beslissingen #4, #6, #7 en het `service.ts` skeleton in #15 zijn aangepast; type van `CreateBetResult.inviteToken` is `string | null`. Test #14e asserteer `result2.inviteToken === null`.

### Q3 — `z.coerce.bigint()` voor BET stake env vars (AKKOORD)

`BET_MIN_USDC_UNITS` + `BET_MAX_USDC_UNITS` worden `z.coerce.bigint()` velden in `env.ts` met BigInt-defaults (`1_000_000n` / `10_000_000_000n`). Vereist zod ≥ 3.20 — pre-flight check in Step 0 valideert dit:

```bash
node -e "console.log(require('./node_modules/zod/package.json').version)"
# Verwacht: 3.20.x of hoger
```

Als zod < 3.20: fallback naar `z.string().transform((s) => BigInt(s))`. Geen blocker voor uitvoering; service-laag gebruik blijft identiek (`getEnv().BET_MIN_USDC_UNITS` is BigInt in beide gevallen).

### Q4 — Test count target = 70 (AKKOORD)

52 baseline + 15 lifecycle + 3 safe-compare unit = 70. `Doel`-sectie, post-flight check 7, en commit-message reflecteren 70.

---

Spec is uitvoeringsklaar. Wachten op final akkoord voor Step 0 start.
