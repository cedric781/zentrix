# PROMPT_11 — Pool lifecycle services

**Refactor fase 4 deliverable.** Pool-laag (tournament-container CRUD) bovenop de bet services uit P09/P10, conform [ADR-0003](./ADR-0003-1v1-with-tournament-pools.md) §2 (Pool feature, vereenvoudigde shape) en [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) §4 (PROMPT_11 scope).

---

## Doel

Implementeer de vier lifecycle services voor Pool als tournament-container:

- `createPool` — maakt Pool in DRAFT status; creator is de organizer (niet bettor — pool-creator-cannot-bet trigger blijft hard-guard).
- `publishPool` — DRAFT → OPEN; pool wordt zichtbaar voor bettors, Match-toevoeging start vanaf hier (Match-management komt P12).
- `closePool` — OPEN → CLOSED; geen nieuwe Match-additions of Bet-attachments meer mogelijk; per-Match settlement loopt door (P12).
- `cancelPool` — DRAFT → CANCELLED; alleen vóór publish, defensieve bet-count guard.

Pool zelf is **geld-loos**: geen escrow account, geen ledger transactions in P11. Pool is metadata-container; geld leeft op individuele Bets binnen Matches binnen de Pool.

**Niet** in scope:
- Match management (`addMatchToPool`, `listMatches`, etc.) — komt **PROMPT_12**.
- Match result submission (creator submit pool-uitslag → all-Bets-on-Match SETTLED) — komt **PROMPT_12**.
- Pool settlement (CLOSED → SETTLED wanneer alle matches settled) — komt **PROMPT_12** als afsluiter van match-result flow.
- Pool dispute handling — komt **PROMPT_13**.
- HTTP routes — komen **PROMPT_16**.

Test count target na P11: 88 → ~104 (16 nieuwe pool-lifecycle tests).

---

## Builds on

- **PROMPT_07** ledger — onaangetast in P11 (geen ledger writes).
- **PROMPT_08** schema (commit `1618b27`, tag `refactor-fase-1`) — `Pool` model met 5-veld minimal shape (id, createdById, title, description?, status, bettingClosesAt + timestamps), `PoolStatus` enum 5 waardes (DRAFT, OPEN, CLOSED, SETTLED, CANCELLED), `bets_creator_cannot_bet_on_own_pool_match` trigger blijft hard-guard.
- **PROMPT_09** (commit `c48927c`, tag `refactor-fase-2`) — patroon: `BetError` class + namespaced error codes, `lockBet` helper FOR UPDATE pattern, `prisma.$transaction` wrap convention, UUID v4 idempotency-key validation, defensive optimistic-lock via WHERE-status. P11 mirrors deze patterns met nieuwe `PoolError`+`lockPool`.
- **PROMPT_10** (commit `7496fa9`, tag `refactor-fase-3`) — `IdempotencyKey` extended-shape table actief gebruikt voor non-ledger ops? **Nee** — P10 koos natural-DB-state via `BetResultClaim @@unique`. P11 introduceert het *eerste* gebruik van de `IdempotencyKey` extended-shape table voor service-laag idempotency (zie #7).
- **ADR-0003 §2** — Pool als tournament-container van N Matches; geen aggregate side/pot fields (parimutuel-resten), geen creator-fee splits per pool. Pool is operator-feature, niet wedding-medium.
- **Memory `feedback_zentrix_rules.md`** — geen schema-mutaties zonder expliciet "go". P11 ships zonder migrations.

---

## Files touched

| File | Mutatie | Omvang |
|---|---|---|
| `src/lib/pools/errors.ts` | NEW — `PoolError` class + 7-code union, mirror `BetError` pattern | ~30 regels |
| `src/lib/pools/service.ts` | NEW — `lockPool` helper + `createPool` + `publishPool` + `closePool` + `cancelPool` | ~340 regels |
| `src/__tests__/pools/pool-lifecycle.test.ts` | NEW — 16 tests (4 per service + 1 race edge) | ~520 regels |

Geen aanpassingen aan `prisma/schema.prisma`. Geen migrations. `src/lib/pools/` is leeg na refactor-fase-0; P11 herintroduceert het met de nieuwe (vereenvoudigde) shape.

**Belangrijk:** P11 is de eerste consument van `IdempotencyKey` extended-shape (`userId`, `route`, `responseJson`, `expiresAt` velden uit P08). P05/P06 deposit/withdrawal-routes gebruiken alleen `key + scope`. Service-laag in P11 vult ook `userId`, `responseJson` en `expiresAt`.

---

## Pre-flight verificatie

```bash
cd ~/zentrix

# 1. Branch + commit state
git status                                       # clean working tree
git log --oneline -1                             # 7496fa9 (refactor-fase-3)
git tag -l | grep refactor-fase-3                # bestaat

# 2. Tests baseline = 88
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  88 passed (88)"

# 3. Pool model + 5-status enum
grep -E "^model Pool|^enum PoolStatus" prisma/schema.prisma
grep -A 7 "^enum PoolStatus" prisma/schema.prisma | grep -cE "DRAFT|OPEN|CLOSED|SETTLED|CANCELLED"
# Verwacht: 5

# 4. src/lib/pools/ is leeg
ls src/lib/pools 2>&1
# Verwacht: "No such file or directory"

# 5. IdempotencyKey extended-shape velden bestaan
grep -E "userId|responseJson|expiresAt" prisma/schema.prisma | grep -c "idempotency_keys\|@map"
# Verwacht: meerdere matches

# 6. WSL heap-flag conventie
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"
```

Stop bij rood op één van deze checks.

---

## Beslissingen

12 numbered decisions. Format: **wat** + **waarom**.

### 1. `PoolError` class + 7-code union — mirror `BetError`

```typescript
// src/lib/pools/errors.ts
import "server-only";

export type PoolErrorCode =
  | "POOL_NOT_FOUND"               // 404
  | "POOL_NOT_OWNED_BY_CALLER"     // 403
  | "POOL_INVALID_STATUS"          // 409
  | "POOL_INVALID_INPUT"           // 400
  | "POOL_VERSION_MISMATCH"        // 409 — defensive optimistic lock via status-guard
  | "POOL_HAS_BETS_CANNOT_CANCEL"  // 409 — non-DRAFT met active/possible bets
  | "POOL_DEADLINE_INVALID";       // 400 — bettingClosesAt buiten [1h, 90d] of al voorbij

export class PoolError extends Error {
  constructor(
    public code: PoolErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "PoolError";
  }
}
```

**Waarom 7 codes:** voldoende voor de 4 services + 1 helper (lockPool). Geen overlap met BetError (Pool en Bet zijn aparte bounded contexts; geen gedeelde error-class). Per ADR-0003 + project `feedback_zentrix_rules.md` regel 3 ("no duplicate code") — error class blijft per context.

**`POOL_VERSION_MISMATCH` ondanks geen `version` field op Pool:** Pool heeft geen `version` kolom (per P08 schema decision — Pool is metadata-only, geen high-frequency mutations verwacht). De code wordt gegooid wanneer een `updateMany` met `WHERE status=expected` count !== 1 returnt — d.w.z. een concurrent caller heeft de status al gemuteerd. Status-as-version pattern (defensive optimistic lock).

---

### 2. `createPool` input + flow

```typescript
export interface CreatePoolInput {
  creatorId: string;
  title: string;
  description?: string;
  bettingClosesAt: Date;
  idempotencyKey: string;
}

export interface CreatePoolResult {
  pool: Pool;
}
```

Flow (in `prisma.$transaction`):

```text
1. Cheap input validation:
   - assertUuidV4(idempotencyKey)
   - title.trim().length in [1, 200]
   - description (if set) .trim().length <= 2000
   - bettingClosesAt is Date object
   - msAhead = bettingClosesAt.getTime() - Date.now()
     msAhead in [3_600_000, 90 * 24 * 3_600_000] (1 uur tot 90 dagen)
     Anders: POOL_DEADLINE_INVALID

2. Idempotency check via IdempotencyKey extended-shape:
   const namespacedKey = `pool-create:${idempotencyKey}`;
   const existing = await tx.idempotencyKey.findUnique({
     where: { key: namespacedKey }
   });
   if (existing?.responseJson) {
     const { poolId } = existing.responseJson as { poolId: string };
     const replayed = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
     return { pool: replayed };
   }

3. Insert Pool row:
   const pool = await tx.pool.create({
     data: {
       createdById: creatorId,
       title: title.trim(),
       description: description?.trim() ?? null,
       status: "DRAFT",
       bettingClosesAt,
     }
   });

4. Insert IdempotencyKey row:
   await tx.idempotencyKey.create({
     data: {
       key: namespacedKey,
       scope: "pool-create",
       userId: creatorId,
       responseJson: { poolId: pool.id } as Prisma.InputJsonValue,
       completedAt: new Date(),
       expiresAt: new Date(Date.now() + 24 * 3600_000),  // 24h TTL
     }
   });

5. Return { pool }.
```

**Geen pre-validatie van creatorId existence:** `tx.pool.create` zal een FK-violation gooien als `createdById` niet bestaat. Dat is een service-input-error die in P16 HTTP-laag al gevangen zou zijn (auth-middleware). Geen extra guard hier.

**`title.trim()` + `description.trim()`:** witruimte aan begin/eind verwijderd; lege strings na trim → POOL_INVALID_INPUT (length === 0).

**Geen lockPool nodig in createPool:** geen bestaande Pool om te locken. Insert is atomair via Postgres unique constraints (uuid generated).

---

### 3. `publishPool` input + flow (DRAFT → OPEN)

```typescript
export interface PublishPoolInput {
  poolId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface PublishPoolResult {
  pool: Pool;
}
```

Flow:

```text
1. assertUuidV4(idempotencyKey)

2. Idempotency check on `pool-publish:${idempotencyKey}`:
   findUnique → if exists, parse responseJson { poolId }, return existing pool.

3. lockPool(tx, poolId).
   Re-fetch via tx.pool.findUniqueOrThrow.

4. Guards:
   - pool.createdById === callerId → anders POOL_NOT_OWNED_BY_CALLER (403).
   - pool.status === "DRAFT" → anders POOL_INVALID_STATUS (409).
   - pool.bettingClosesAt.getTime() > Date.now() → anders POOL_DEADLINE_INVALID
     met message "deadline already passed at create-time validation,
                  re-validation failed at publish".

5. updateMany met status-guard:
   const updated = await tx.pool.updateMany({
     where: { id: poolId, status: "DRAFT" },
     data: { status: "OPEN" }
   });
   updated.count !== 1 → POOL_VERSION_MISMATCH.

6. Insert IdempotencyKey row (scope="pool-publish", responseJson={poolId}, ...).

7. Return updated pool (re-fetch).
```

**Waarom `bettingClosesAt > now` guard ook bij publish:** een DRAFT pool kan oud zijn (gemaakt 2 dagen geleden) en `bettingClosesAt` kan inmiddels voorbij zijn. Publishen van een al-verlopen pool zou directly geen accept-window opleveren — sorry to fail-fast. Frontend/route kan oplossen door eerst `bettingClosesAt` te updaten via een (niet in P11 scope) `updatePool` service.

---

### 4. `closePool` input + flow (OPEN → CLOSED)

```typescript
export interface ClosePoolInput {
  poolId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface ClosePoolResult {
  pool: Pool;
}
```

Flow:

```text
1. assertUuidV4(idempotencyKey)
2. Idempotency check on `pool-close:${idempotencyKey}`.
3. lockPool + refetch.
4. Guards:
   - createdById === callerId → POOL_NOT_OWNED_BY_CALLER.
   - status === "OPEN" → anders POOL_INVALID_STATUS.
   (Geen deadline check — closing kan ook na bettingClosesAt; that's the
   intended path.)
5. updateMany met status-guard "OPEN" → "CLOSED".
6. Insert IdempotencyKey row.
7. Return.
```

**`closePool` settled NIET de pool.** Pool gaat OPEN → CLOSED, niet → SETTLED. Per ADR-0003 §2: per-Match settlement loopt onafhankelijk. Pool transitie naar SETTLED gebeurt in P12 als alle matches SETTLED zijn (auto-transition na laatste match settle). **P11 implementeert de OPEN→SETTLED pad NIET** — het is uitsluitend OPEN → CLOSED handmatige stop op nieuwe Match/Bet additions.

**Waarom geen guard "betsAttached count > 0 required":** een pool kan CLOSED zonder dat er ooit bets zijn geweest (organizer setup-but-no-traction). Empty pools zijn legaal; de DRAFT → OPEN → CLOSED → SETTLED keten kan met 0 bets doorlopen worden. Settlement-step (P12) handelt empty case af.

---

### 5. `cancelPool` input + flow (DRAFT → CANCELLED)

```typescript
export interface CancelPoolInput {
  poolId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface CancelPoolResult {
  pool: Pool;
}
```

Flow:

```text
1. assertUuidV4(idempotencyKey)
2. Idempotency check on `pool-cancel:${idempotencyKey}`.
3. lockPool + refetch.
4. Guards (in deze volgorde):
   a. createdById === callerId → POOL_NOT_OWNED_BY_CALLER.
   b. status === "DRAFT" → anders POOL_HAS_BETS_CANNOT_CANCEL met
      state-specifieke message:
        - OPEN     → "pool is published; close via dispute/refund flow (P13/P15)"
        - CLOSED   → "pool is closed; settlement runs per-match (P12)"
        - SETTLED  → "pool already settled; no action needed"
        - CANCELLED→ "pool already cancelled"
      Eén code, vier message-varianten — frontend kan via message routeren
      of via separate `bet.poolId !== null` + `pool.status` zelf besluiten.
   c. (Defensive) prisma.bet.count({where:{poolId}}) === 0 →
      anders POOL_HAS_BETS_CANNOT_CANCEL met message
      "pool has attached bets; cannot cancel — defensive guard,
       indicates corrupt state if reached on a DRAFT pool".
5. updateMany met status-guard "DRAFT" → "CANCELLED".
6. Insert IdempotencyKey row.
7. Return.
```

**Waarom `POOL_HAS_BETS_CANNOT_CANCEL` voor zowel non-DRAFT als DRAFT-met-bets (Q1-resolved):** één code, vier state-specifieke messages. Frontend krijgt genoeg info via message-string om passende UI te tonen (bv. "go to refund flow" voor OPEN, "already done" voor SETTLED). Code-naam is iets minder pittig voor SETTLED/CANCELLED maar de message-string compenseert. Alternatief twee-code split was zuiverder semantisch maar voegt code-bloat toe voor weinig praktisch verschil.

**Defensive bet-count check op DRAFT:** In normaal gebruik kan een DRAFT pool geen bets hebben omdat `createBet` rejects pools waar `pool.status !== "OPEN"`. Een rauwe DB-insert (buiten service om) kan deze invariant breken; de defensive check vangt dat. Cost: één extra COUNT-query per cancel — verwaarloosbaar (zelden-aangeroepen pad).

**Waarom DRAFT-only cancel:** OPEN/CLOSED pools hebben mogelijk Bets met escrow vast. Cancellen zou geld-vaste situatie creëren waarin escrow nooit terug-betaald wordt. Refund-pad voor OPEN/CLOSED pools loopt via dispute (P13) of expiry-cron (P15) — nooit via direct cancel. Deze regel is conservatief: niet "weet creator of er bets zijn", maar "bet-bevattende pools cancellen is buiten scope, gebruik dispute/refund".

---

### 6. `lockPool` helper — mirror `lockBet`

```typescript
export async function lockPool(
  tx: TxClient,
  poolId: string,
): Promise<{ id: string }> {
  const rows = (await tx.$queryRaw`
    SELECT id FROM pools WHERE id = ${poolId} FOR UPDATE
  `) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new PoolError("POOL_NOT_FOUND", `Pool ${poolId} not found`, 404);
  }
  return { id: rows[0].id };
}
```

**Pattern identiek aan `lockBet`** (zie `src/lib/bets/service.ts`). `as Array<...>` cast in plaats van generic `<{}>` template — voorkomt tsc segfault op heavy-template-literal types (zelfde fix als P09 commit `9282bd3` + P10 commit `7496fa9`).

**Geen import van `lockBet`:** Pool en Bet zijn aparte bounded contexts; locking-helpers per context. DRY-principe gerespecteerd door identieke implementatie via copy-not-import (10-regel functie, geen logica te abstrigeren).

---

### 7. Idempotency strategie — `IdempotencyKey` extended-shape (eerste service-laag gebruik)

P11 is de eerste service waar de `IdempotencyKey` extended-shape velden uit P08 daadwerkelijk gebruikt worden. P09/P10 leunen op `LedgerTransaction.idempotencyKey @unique` (ledger-keyed) en `BetResultClaim @@unique` (natural-DB-state). Pool services schrijven geen ledger en hebben geen natural unique anchor — dus IdempotencyKey table is de enige plek.

**Schema gebruik:**
- `key` (primary key): namespaced `pool-{action}:{idempotencyKey}` — globally unique via `@id`.
- `scope`: `"pool-create"` | `"pool-publish"` | `"pool-close"` | `"pool-cancel"`.
- `userId`: `creatorId` (createPool) of `callerId` (publish/close/cancel).
- `responseJson`: `{ poolId: string }` — minimaal, want de Pool kan via `tx.pool.findUniqueOrThrow({where:{id:poolId}})` opnieuw geladen worden.
- `completedAt`: `new Date()` — timestamp van succesvolle write.
- `expiresAt`: `new Date(Date.now() + 24 * 3600_000)` — 24h TTL, voorbereiding op P15 cron-cleanup.

**Replay flow:**
```typescript
const namespacedKey = `pool-${action}:${idempotencyKey}`;
const existing = await tx.idempotencyKey.findUnique({
  where: { key: namespacedKey },
});
if (existing?.responseJson) {
  const { poolId } = existing.responseJson as { poolId: string };
  const replayed = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
  return { pool: replayed };
}
```

**Waarom `findUnique` op `key` (niet composite `userId_key`):** key is `@id` dus globally unique; `findUnique({where:{key:...}})` is direct + atomair. Composite would werken via `where: {userId_key: {userId, key}}` maar levert geen extra waarde — UUID v4 in caller-supplied keys heeft 122 bits entropy, collision tussen users praktisch ondenkbaar.

**Geen update-on-replay:** als de existing record's `responseJson` corrupt of `null` is, gooi `Error` ("idempotency record corrupt"). Niet silent recover want dat verbergt een data-integriteitsprobleem.

---

### 8. Geen `BetStateTransition`-equivalent voor Pool

Pool heeft geen audit-tabel in schema (per P08 schema beslissing — `feedback_wager_patterns.md` regel "Pool is metadata, geen geld-dragend object" + ADR-0003 §"What is new" lijst geen `PoolStateTransition`). P11 ships zonder audit.

**Status changes loggen via observability/pino:** future P15 invariants prompt kan een gestandaardiseerde logger-call (`logger.info({poolId, fromStatus, toStatus, actorId})`) toevoegen. P11 ships zonder logging in service-layer (consistent met P09/P10 — logging hoort in P16 routes).

**Future migration option:** als audit ooit nodig blijkt, kan een `PoolStateTransition` tabel worden toegevoegd zonder breaking change voor bestaande services (additieve migration).

---

### 9. Geen `version` field op Pool — status-as-optimistic-lock

Pool heeft geen `version Int @default(0)` kolom (per P08 schema). Optimistic-lock pattern in P11 services gebruikt **status-as-version**:

```typescript
const updated = await tx.pool.updateMany({
  where: { id: poolId, status: expectedFromStatus },  // ← status acts as version
  data: { status: targetStatus }
});
if (updated.count !== 1) {
  throw new PoolError("POOL_VERSION_MISMATCH", ...);
}
```

Dit werkt voor *status-mutaties* (DRAFT → OPEN → CLOSED → CANCELLED) omdat elke mutatie een nieuwe status oplevert. Voor *non-status mutaties* (e.g., editing title) zou versionsless updates geen race-protection bieden — maar P11 doet alleen status-changes.

**Future `updatePool` service (niet in scope):** zou ofwel een version-field nodig hebben (schema migration) of een snapshot-vergelijking (vergelijk full-row-state). P11 verlegt dat naar latere prompt.

---

### 10. Geen ledger writes in P11

Pool services raken geen `recordTransaction`, geen `LedgerTransaction`, geen `FinancialAccount` aan. Pool is metadata-container — geen escrow account per pool (escrow leeft per Bet via `bet:{betId}` scope, nooit per pool). Dit is een expliciete ADR-0003 §2 keuze: parimutuel-pools hadden pool-escrow; 1v1+container heeft per-bet-escrow.

**Implicaties:**
- Geen circuit-breaker check in P11 services (al gemarkeerd als P15 scope voor bet-services; pool-services hebben sowieso geen money-movement).
- Geen invariant cron-impact (P07 recon checks ledger; P11 raakt ledger niet).
- Test fund-helpers in P11 tests zijn alleen nodig voor de defensive-bet-count test in cancelPool (insert raw Bet via prisma) — geen makeUser-with-balance helper nodig.

---

### 11. Test structuur — 16 tests

Bestand: `src/__tests__/pools/pool-lifecycle.test.ts`. Cleanup pattern: `SUFFIX + PRIVY_PREFIX`, IdempotencyKey rows met scope startswith "pool-".

#### createPool (4)

- **a. Happy path** — call createPool met geldige inputs → Pool DRAFT, alle velden correct (title trimmed, description null, bettingClosesAt 24h ahead). IdempotencyKey row met scope "pool-create" + responseJson.
- **b. Title length out of range** — title `""` → POOL_INVALID_INPUT; title 201 chars → POOL_INVALID_INPUT.
- **c. Deadline out of range** — bettingClosesAt 30 min ahead → POOL_DEADLINE_INVALID; 91 dagen ahead → POOL_DEADLINE_INVALID; 1 dag in verleden → POOL_DEADLINE_INVALID.
- **d. Idempotent replay** — twee createPool calls met zelfde idempotencyKey → tweede returnt zelfde pool (replay). Eén Pool row, één IdempotencyKey row.

#### publishPool (4)

- **a. Happy path DRAFT → OPEN** — createPool, dan publishPool → status OPEN. IdempotencyKey row scope "pool-publish".
- **b. Non-creator** — createPool door user A, publishPool door user B → POOL_NOT_OWNED_BY_CALLER (403).
- **c. Already OPEN** — publishPool tweemaal achter elkaar (different idempotency keys) → tweede call POOL_INVALID_STATUS (status nu OPEN, niet DRAFT).
- **d. Deadline expired** — createPool met `bettingClosesAt` close-bij; handmatig `tx.pool.update({bettingClosesAt: <past>})`; publishPool → POOL_DEADLINE_INVALID.

#### closePool (3)

- **a. Happy path OPEN → CLOSED** — createPool → publishPool → closePool → status CLOSED.
- **b. Non-creator** — closePool door non-owner → POOL_NOT_OWNED_BY_CALLER.
- **c. DRAFT pool** — closePool zonder publishPool eerst → POOL_INVALID_STATUS.

#### cancelPool (4)

- **a. Happy path DRAFT → CANCELLED** — createPool → cancelPool → status CANCELLED.
- **b. Pool OPEN cannot cancel** — createPool → publishPool → cancelPool → POOL_HAS_BETS_CANNOT_CANCEL.
- **c. DRAFT pool met attached bet (defensive)** — createPool, dan handmatig een Bet inserten met `poolId` (via `prisma.bet.create({data: {..., poolId}})` met dummy stake) — note: dit bypassed de service-laag pool.status guard. Daarna cancelPool → POOL_HAS_BETS_CANNOT_CANCEL.
- **d. Idempotent replay** — twee cancelPool calls met zelfde idempotencyKey → tweede returnt cancelled pool. Eén IdempotencyKey row.

#### Race edge case (1)

- **a. Parallel publishPool × 2** — twee parallel calls met *verschillende* idempotency keys → één succeeds (status DRAFT → OPEN), ander krijgt POOL_INVALID_STATUS (FOR UPDATE serializeerd, tweede ziet niet-DRAFT). De `POOL_VERSION_MISMATCH` is dood-pad onder normale FOR UPDATE; alleen zichtbaar als FOR UPDATE per ongeluk weggehaald wordt. Test asserteer `["POOL_INVALID_STATUS", "POOL_VERSION_MISMATCH"]`.includes(error.code).

#### Test infrastructure

```typescript
const SUFFIX = `pool-lifecycle-${Date.now()}`;
const PRIVY_PREFIX = `pl-${SUFFIX}-`;
const testUserIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: {
      privyId: `${PRIVY_PREFIX}${label}`,
      email: `${PRIVY_PREFIX}${label}@example.com`,
    },
  });
  testUserIds.push(user.id);
  return user;
}

function newKey(): string {
  return crypto.randomUUID();
}

async function fullCleanup() {
  // FK volgorde: bets -> pools -> users; idempotency rows separately.
  await prisma.betStateTransition.deleteMany({});
  await prisma.betParticipant.deleteMany({});
  await prisma.betInvite.deleteMany({});
  await prisma.bet.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.idempotencyKey.deleteMany({
    where: { scope: { startsWith: "pool-" } },
  });
  await prisma.user.deleteMany({
    where: { privyId: { startsWith: PRIVY_PREFIX } },
  });
  // Geen treasury/external reset nodig — P11 doet geen ledger writes.
}

beforeAll(fullCleanup);
afterAll(async () => {
  await fullCleanup();
  await prisma.$disconnect();
});
```

**`makeUser` zonder funding:** P11 services raken geen accounts; users hoeven geen balance.

**Cleanup ook bet-tabellen:** test #cancelPool-c insert een Bet handmatig via `prisma.bet.create` met dummy data. Cleanup moet die opruimen voordat user.deleteMany() FK-conflicten veroorzaakt.

**Geen IdempotencyKey global cleanup:** alleen rows met `scope starts with "pool-"` worden verwijderd, om eventuele P05/P06 deposit/withdrawal idempotency rows van andere test files niet te raken.

---

### 12. Pool services skeleton

```typescript
// src/lib/pools/service.ts
import "server-only";
import crypto from "node:crypto";
import { Prisma, type Pool } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type TxClient } from "@/lib/ledger";
import { PoolError } from "./errors";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TITLE_MIN = 1;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const BETTING_DEADLINE_MIN_MS = 60 * 60 * 1000;          // 1 uur
const BETTING_DEADLINE_MAX_MS = 90 * 24 * 60 * 60 * 1000; // 90 dagen
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;   // 24 uur — geëxporteerd voor P15 cron-cleanup hergebruik

export interface CreatePoolInput { /* zie #2 */ }
export interface CreatePoolResult { pool: Pool }
export interface PublishPoolInput { /* zie #3 */ }
export interface PublishPoolResult { pool: Pool }
export interface ClosePoolInput { /* zie #4 */ }
export interface ClosePoolResult { pool: Pool }
export interface CancelPoolInput { /* zie #5 */ }
export interface CancelPoolResult { pool: Pool }

export async function createPool(input: CreatePoolInput): Promise<CreatePoolResult> { /* #2 */ }
export async function publishPool(input: PublishPoolInput): Promise<PublishPoolResult> { /* #3 */ }
export async function closePool(input: ClosePoolInput): Promise<ClosePoolResult> { /* #4 */ }
export async function cancelPool(input: CancelPoolInput): Promise<CancelPoolResult> { /* #5 */ }

// ── helpers ──────────────────────────────────────────────────────────

export async function lockPool(tx: TxClient, poolId: string) { /* #6 */ }

function assertUuidV4(key: string, fieldName: string): void {
  if (!UUID_V4.test(key)) {
    throw new PoolError("POOL_INVALID_INPUT", `${fieldName} must be a UUID v4`, 400);
  }
}

async function findReplayedPool(
  tx: TxClient, namespacedKey: string,
): Promise<Pool | null> {
  const existing = await tx.idempotencyKey.findUnique({ where: { key: namespacedKey } });
  if (!existing) return null;
  if (!existing.responseJson) {
    throw new Error(`IdempotencyKey ${namespacedKey} has no responseJson`);
  }
  const { poolId } = existing.responseJson as { poolId: string };
  return await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
}

async function recordIdempotency(
  tx: TxClient,
  namespacedKey: string,
  scope: string,
  userId: string,
  poolId: string,
): Promise<void> {
  await tx.idempotencyKey.create({
    data: {
      key: namespacedKey,
      scope,
      userId,
      responseJson: { poolId } as Prisma.InputJsonValue,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
  });
}
```

**`findReplayedPool` + `recordIdempotency` helpers** dedupen het idempotency-pattern over de 4 services. Niet over-abstrahieren — alleen gemeenschappelijke shape (lookup + write).

**Geen logging in service.ts:** consistent met P09/P10 — service-functies zijn pure, logging hoort in P16 routes.

---

## ── BEGIN PROMPT — uitvoering ──

You are extending zentrix met de Pool lifecycle services voor refactor fase 4. **De single most important rule:** Pool services raken geen ledger / geen geld / geen Bet-tabellen. Pool is een metadata-container. Idempotency loopt via `IdempotencyKey` extended-shape (eerste service-laag gebruik).

**Hard constraints:**
- Geen ledger writes, geen `recordTransaction` calls in `service.ts`.
- IdempotencyKey rows altijd met namespaced key `pool-{action}:{idempotencyKey}`, scope, userId, responseJson, expiresAt (24h).
- Status-mutaties via `updateMany` met `WHERE status=expected` count-check (status-as-version).
- Defensive bet-count check in `cancelPool` (zie #5 stap 4c) — niet skip.
- `lockPool` mirror van `lockBet` — `as Array<...>` cast pattern voor tsc safety.

---

### Step 0 — Pre-flight

```bash
cd ~/zentrix
git status                                       # clean
git log --oneline -1                             # 7496fa9 (refactor-fase-3)
git tag -l | grep refactor-fase-3                # bestaat
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  88 passed (88)"
ls src/lib/pools 2>&1
# Verwacht: "No such file or directory" (klaar voor nieuwe files)
```

Stop bij rood.

---

### Step 1 — `src/lib/pools/errors.ts`

Maak nieuw bestand met `PoolError` class + `PoolErrorCode` 7-code union per #1.

```bash
mkdir -p src/lib/pools
# write src/lib/pools/errors.ts
grep -cE "\"POOL_(NOT_FOUND|NOT_OWNED_BY_CALLER|INVALID_STATUS|INVALID_INPUT|VERSION_MISMATCH|HAS_BETS_CANNOT_CANCEL|DEADLINE_INVALID)\"" src/lib/pools/errors.ts
# Verwacht: 7
```

---

### Step 2 — `src/lib/pools/service.ts`

Implementeer in volgorde:
1. Constants + interfaces.
2. Helpers: `lockPool`, `assertUuidV4`, `findReplayedPool`, `recordIdempotency`.
3. `createPool` per #2.
4. `publishPool` per #3.
5. `closePool` per #4.
6. `cancelPool` per #5.

Sanity per service:
```bash
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm typecheck
```

Bij segfault (139): `rm -f tsconfig.tsbuildinfo` + retry.

---

### Step 3 — `src/__tests__/pools/pool-lifecycle.test.ts`

```bash
mkdir -p src/__tests__/pools
# write test file met 16 tests per #11
```

Volgorde van tests-schrijven:
1. createPool happy + invalid-input + deadline-invalid + idempotent.
2. publishPool happy + non-creator + already-OPEN + deadline-expired.
3. closePool happy + non-creator + DRAFT-status.
4. cancelPool happy + OPEN-blocked + DRAFT-with-bet-blocked + idempotent.
5. Race parallel publishPool.

Per groep test-runs:
```bash
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm vitest run src/__tests__/pools/pool-lifecycle.test.ts
```

---

### Step 4 — Volledige validatie

```bash
rm -f tsconfig.tsbuildinfo
pnpm prisma format
pnpm prisma validate
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm typecheck
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test
# Verwacht: "Tests  104 passed (104)"  (88 + 16)
```

WSL flake retry per ervaring P09/P10: 1× herhalen lost typecheck-segfault op.

---

### Step 5 — Commit + tag + push

```bash
git add src/lib/pools/errors.ts src/lib/pools/service.ts \
        src/__tests__/pools/pool-lifecycle.test.ts

git status

git commit -m "$(cat <<'COMMIT_MSG'
feat(pools): lifecycle services createPool/publishPool/closePool/cancelPool (PROMPT_11, refactor fase 4)

Implementeert Pool tournament-container CRUD per ADR-0003 §2 en
REFACTOR_PLAN fase 4.

Services:
- createPool: maakt Pool in DRAFT status. Title 1-200 chars, description
  optional ≤2000, bettingClosesAt within [1h, 90d] ahead.
- publishPool: DRAFT -> OPEN. Owner-only. Re-validates deadline > now
  to fail-fast on stale drafts.
- closePool: OPEN -> CLOSED. Owner-only. Stops new Match/Bet attachments;
  per-Match settlement (P12) blijft doorlopen.
- cancelPool: DRAFT -> CANCELLED. Alleen DRAFT zonder attached bets.
  Defensive bet-count check vangt rauwe DB-inserts (DRAFT pool zou
  via service-laag geen bets kunnen hebben — pool.status guard in
  createBet weert ze).

Helpers:
- lockPool (FOR UPDATE row lock, mirror van lockBet pattern uit P09).
- PoolError class + 7-code union (POOL_NOT_FOUND, POOL_NOT_OWNED_BY_CALLER,
  POOL_INVALID_STATUS, POOL_INVALID_INPUT, POOL_VERSION_MISMATCH,
  POOL_HAS_BETS_CANNOT_CANCEL, POOL_DEADLINE_INVALID).

Idempotency:
- IdempotencyKey extended-shape table (eerste service-laag consument na
  P08 schema). Namespaced key pool-{action}:{idempotencyKey}, scope per
  action, responseJson { poolId }, 24h TTL via expiresAt.
- Geen ledger keys (Pool services schrijven geen ledger).

Design constraints:
- Pool is geld-loos: geen escrow, geen ledger writes, geen circuit
  breaker check (consistent met P09/P10).
- Geen StateTransition table (per P08 schema beslissing).
- Status-as-version optimistic lock (Pool heeft geen version field).
- closePool gaat NIET naar SETTLED — P12 handelt pool-SETTLED af na
  alle matches settled.

Tests (16 nieuwe):
- createPool: happy, title length out-of-range, deadline out-of-range,
  idempotent replay.
- publishPool: happy DRAFT->OPEN, non-creator, already-OPEN, expired
  deadline.
- closePool: happy OPEN->CLOSED, non-creator, DRAFT-not-OPEN.
- cancelPool: happy DRAFT->CANCELLED, OPEN-blocked, DRAFT-with-bet-blocked
  (defensive), idempotent.
- Race: parallel publishPool x 2 — one wins, other POOL_INVALID_STATUS.

Test count: 88 -> 104.

Pre-PROMPT_12 (Match management + match result submission).
Reference: ADR-0003 (e9fc0c5), REFACTOR_PLAN (7fc4bbb), P08 schema (1618b27),
P09 lifecycle (c48927c), P10 settlement (7496fa9), P11 spec (xxxxxxx).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT_MSG
)"

git tag refactor-fase-4
git log --oneline -5
git push origin main
git push origin refactor-fase-4
```

Replace `xxxxxxx` met de spec-commit hash.

---

## Post-flight checks

```bash
# 1. Service exports
grep -E "^export (async )?function (createPool|publishPool|closePool|cancelPool|lockPool)\b" src/lib/pools/service.ts
# Verwacht: 5 matches

# 2. Geen ledger imports in pool service
grep -nE "recordTransaction|LedgerTransaction" src/lib/pools/service.ts
# Verwacht: niets — pool services zijn ledger-loos

# 3. Geen $queryRaw met generic (tsc safety)
grep -nE "\\\$queryRaw<" src/lib/pools/service.ts
# Verwacht: niets — gebruik 'as Array<...>' cast

# 4. IdempotencyKey scope namespace consistent
grep -E "scope: \"pool-" src/lib/pools/service.ts | sort -u
# Verwacht: pool-create, pool-publish, pool-close, pool-cancel (4 unieke)

# 5. PoolError gebruikt
grep -c "throw new PoolError" src/lib/pools/service.ts
# Verwacht: minstens 10 (multiple guards across 4 services)

# 6. Test count
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep "Tests"
# Verwacht: "Tests  104 passed (104)"

# 7. IdempotencyKey rows na cleanup (sanity)
# (in test file: afterAll cleanup deletes scope startsWith "pool-")
```

---

## Wat dit NIET doet

- **Geen Match management.** `addMatchToPool`, `removeMatch`, `listMatches` komen **PROMPT_12**.
- **Geen match result submission.** `submitMatchResult` (creator zet match winner-side) komt **PROMPT_12** en triggert auto-settlement van alle Bets op die Match (P12 spec gebruikt `settleBet` helper uit P10).
- **Geen pool-SETTLED transitie.** `closePool` gaat OPEN → CLOSED, niet → SETTLED. De OPEN/CLOSED → SETTLED stap leeft in P12 (auto-transition wanneer alle matches in pool SETTLED zijn).
- **Geen pool-niveau dispute.** Disputes zijn per-Bet of per-Match (P12+P13), niet per Pool.
- **Geen edit-pool service.** Title/description/deadline aanpassen na DRAFT komt later (post-MVP), vereist of `version` field of full-row-snapshot vergelijking.
- **Geen reputation impact.** Pool-creator reputation snapshots komen P14.
- **Geen circuit-breaker check.** Consistent met P09/P10 — pool services hebben sowieso geen geld-bewegingen om te beschermen.
- **Geen HTTP routes.** `POST /api/pools`, `POST /api/pools/:id/publish`, etc. komen P16 met `withIdempotency` HTTP-laag wrapper.
- **Geen UI.** Komt P17+.
- **Geen seed data.** `prisma/seed.ts` wordt niet aangepast.
- **Geen schema migrations.** Pool model + PoolStatus enum staan al uit P08; `IdempotencyKey` extended-shape ook al uit P08. P11 is service-laag-only.
- **Geen audit log voor Pool transitions.** Reden in #8.

---

## Volgende stap

Na user-akkoord op deze spec:
- **Stop voor review.** User leest dit document en geeft groen licht of correcties.
- **Daarna uitvoeren** in een latere Claude Code sessie via Steps 0-5.
- Bij groen Step 4: fase 4 commit + tag + push, dan PROMPT_12 spec schrijven (Match management + submitMatchResult).

---

## Beslissingen op open questions

Vier punten besproken; alle vier vastgelegd op 2026-05-08.

### Q1 — `cancelPool` error code: één `POOL_HAS_BETS_CANNOT_CANCEL` met state-specifieke messages (AKKOORD)

Alle non-DRAFT states krijgen `POOL_HAS_BETS_CANNOT_CANCEL` als error code (zie #5). De message verschilt per state:
- `OPEN` → "pool is published; close via dispute/refund flow (P13/P15)"
- `CLOSED` → "pool is closed; settlement runs per-match (P12)"
- `SETTLED` → "pool already settled; no action needed"
- `CANCELLED` → "pool already cancelled"

DRAFT-met-bets defensive case: "pool has attached bets; cannot cancel — defensive guard, indicates corrupt state if reached on a DRAFT pool".

Eén code houdt de `PoolErrorCode` union compact; de rich messages bieden frontend genoeg signaal voor state-aware UI.

### Q2 — `publishPool` re-validateert deadline > now (AKKOORD)

`publishPool` check `bettingClosesAt > Date.now()`. Bij stale DRAFT (deadline al voorbij): `PoolError("POOL_DEADLINE_INVALID", "deadline already passed at create-time validation, re-validation failed at publish", 400)`. Future `updatePool` service (post-MVP) zal caller-flow geven om deadline te updaten voordat publish opnieuw lukt.

### Q3 — IdempotencyKey TTL hardcoded 24h via `export const` (AKKOORD)

TTL leeft als `export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;` bovenaan `src/lib/pools/service.ts`. Geen env var. `export` zodat P15 cron-cleanup dezelfde constant kan importeren — single source of truth.

Spec impact: skeleton in #12 aangepast (`const` → `export const` + comment).

### Q4 — `POOL_VERSION_MISMATCH` behouden voor consistency met `BET_VERSION_MISMATCH` (AKKOORD)

Code blijft in de `PoolErrorCode` union ondanks dat Pool geen `version` field heeft. Status-as-version pattern levert dezelfde semantische signal: "concurrent-mutation-detected". Caller-laag (P16 routes) kan generiek op `*_VERSION_MISMATCH` suffix matchen voor race-handling, ongeacht of de mutated entity Bet of Pool was.

---

Spec is uitvoeringsklaar. Wachten op final akkoord voor Step 0 start.
