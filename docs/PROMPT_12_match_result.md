# PROMPT_12 — Match management + result submission

**Refactor fase 5 deliverable.** Match-laag (tournament-internal grouping) bovenop Pool services uit P11, plus de result-flow die alle pool-attached Bets via `settleBet` (P10) automatisch resolveert. Conform [ADR-0003](./ADR-0003-1v1-with-tournament-pools.md) §2 (Per-match settlement flow + 24h dispute window) en [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) §4 (PROMPT_12 scope).

---

## Doel

Implementeer Match CRUD + result-submission + auto-resolve flow:

- `addMatchToPool` — pool creator voegt Match toe aan een OPEN Pool (status SCHEDULED).
- `submitMatchResult` — pool creator zet `winnerSide` + optionele evidence; Match → RESULT_SUBMITTED, `disputeWindowEndsAt = now + 24h` gezet. **Géén bet-resolve hier**; window opent alleen.
- `autoResolveMatchBets` (helper, niet service) — na disputeWindow-expiry: alle ACTIVE Bets op de Match SETTLED via `settleBet` helper uit P10. Match → SETTLED.
- `deleteMatch` — pool creator verwijdert SCHEDULED Match (alleen als geen attached bets).

Plus een **uitbreiding** van P09's `createBet` voor de `matchId`-pad: nieuwe error code `BET_POOL_MATCH_NOT_OPEN` voor scherper signaal richting frontend.

Plus een **uitbreiding** van P10's `settleBet`: `fromStatus` accepteert nu ook `"ACTIVE"` (voor pool-match auto-resolve, skipt RESULT_PROPOSED phase).

**Niet** in scope:
- Match dispute services (`openDispute`, `resolveDispute` voor match-level disputes) — komt **PROMPT_13**.
- Reputation impact bij dispute (`UserReputation` snapshots) — komt **PROMPT_14**.
- Cron voor auto disputeWindow-expiry → autoResolveMatchBets — komt **PROMPT_15**. P12 maakt de helper aanroepbaar; cron-trigger is later.
- HTTP routes (`POST /api/pools/:id/matches`, `POST /api/matches/:id/result`, etc.) — komen **PROMPT_16**.

Test count target na P12: 104 → ~126 (22 nieuwe match-tests).

---

## Builds on

- **PROMPT_07** ledger — `recordTransaction` blijft de enige money-mover; settleBet wrap.
- **PROMPT_08** schema (commit `1618b27`) — `Match` model (id, poolId, title, description?, eventTime?, status, winnerSide?, submittedAt?, disputeWindowEndsAt?, settledAt?), `MatchEvidence` met `@@unique([matchId, contentHash])` dedup, `MatchStatus` enum 4 waardes (SCHEDULED, RESULT_SUBMITTED, SETTLED, DISPUTED), `EvidenceType` enum 4 waardes.
- **PROMPT_09** (commit `c48927c`) — `BetError`, `lockBet`, `createBet` met (al bestaande) optionele `matchId` parameter — P12 refined alleen de error code.
- **PROMPT_10** (commit `7496fa9`) — `settleBet` helper in `src/lib/bets/settlement.ts`. P12 breidt `fromStatus` union uit met `"ACTIVE"`.
- **PROMPT_11** (commit `216598d`) — `lockPool` helper, `IdempotencyKey` extended-shape gebruikspattern, `IDEMPOTENCY_TTL_MS` constant (geëxporteerd uit `pools/service.ts`).
- **ADR-0003 §2** — Match als settlement-unit; pool creator submit; 24h dispute window per Match (niet per Pool); pool creator is implicit counterparty bij dispute; per-Match settlement ≠ pool-level.

---

## Files touched

| File | Mutatie | Omvang |
|---|---|---|
| `src/lib/matches/errors.ts` | NEW — `MatchError` class + 8-code union | ~30 regels |
| `src/lib/matches/service.ts` | NEW — `lockMatch` + `addMatchToPool` + `submitMatchResult` + `deleteMatch` | ~360 regels |
| `src/lib/matches/auto-resolve.ts` | NEW — `autoResolveMatchBets` helper, niet exposed als public service | ~130 regels |
| `src/lib/bets/errors.ts` | EDIT — voeg `BET_POOL_MATCH_NOT_OPEN` toe (16 → 17 codes) | +1 regel |
| `src/lib/bets/service.ts` | EDIT — refine `createBet` matchId-pad: gebruik nieuwe error code waar pool niet OPEN is bij match-attached create | ~10 regels diff |
| `src/lib/bets/settlement.ts` | EDIT — `fromStatus: "RESULT_PROPOSED" \| "DISPUTED" \| "ACTIVE"` (union breidt uit) + `actorType` accepts `"POOL_CREATOR_RESOLVE"` voor ACTIVE-pad | ~6 regels diff |
| `src/__tests__/matches/match-lifecycle.test.ts` | NEW — 11 tests (4 addMatch + 5 submitResult + 3 deleteMatch — wait, dat is 12; herstelling: 4 addMatch + 5 submitResult + 3 deleteMatch = 12) | ~440 regels |
| `src/__tests__/matches/match-result.test.ts` | NEW — 10 tests (6 autoResolveMatchBets + 4 edge cases inkl. createBet-met-matchId pad + settleBet ACTIVE-pad) | ~390 regels |

Geen schema-mutaties, geen migrations. P12 leunt volledig op P08 schema.

**Belangrijk:** P12 wijzigt de bestaande `settleBet` signature in `src/lib/bets/settlement.ts`. P10's bestaande callers (alleen `confirmResult` met `fromStatus: "RESULT_PROPOSED"`) blijven werken — TypeScript union-uitbreiding is backward-compatibel.

---

## Pre-flight verificatie

```bash
cd ~/zentrix

# 1. Branch + commit state
git status                                       # clean working tree
git log --oneline -1                             # 216598d (refactor-fase-4)
git tag -l | grep refactor-fase-4                # bestaat

# 2. Tests baseline = 104
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  104 passed (104)"

# 3. src/lib/matches/ leeg
ls src/lib/matches 2>&1
# Verwacht: "No such file or directory"

# 4. Match + MatchEvidence + MatchStatus + EvidenceType in schema
grep -cE "^(model (Match|MatchEvidence)|enum (MatchStatus|EvidenceType))\b" prisma/schema.prisma
# Verwacht: 4

# 5. settleBet helper bestaat
grep -E "^export (async )?function settleBet" src/lib/bets/settlement.ts
# Verwacht: 1 match

# 6. createBet ondersteunt matchId al (uit P09)
grep -E "matchId\?:" src/lib/bets/service.ts
# Verwacht: 1 match (CreateBetInput interface)

# 7. WSL heap-flag conventie
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"
```

Stop bij rood.

---

## Beslissingen

13 numbered decisions.

### 1. `MatchError` class + 8-code union

```typescript
// src/lib/matches/errors.ts
import "server-only";

export type MatchErrorCode =
  | "MATCH_NOT_FOUND"                    // 404
  | "MATCH_NOT_IN_OPEN_POOL"             // 409 — pool moet OPEN voor add/result
  | "MATCH_NOT_OWNED_BY_POOL_CREATOR"    // 403 — alleen pool creator submit/add/delete
  | "MATCH_INVALID_STATUS"               // 409
  | "MATCH_INVALID_INPUT"                // 400
  | "MATCH_VERSION_MISMATCH"             // 409 — defensive, status-as-version
  | "MATCH_HAS_UNRESOLVED_BETS"          // 409 — kan niet schrappen als bets actief
  | "MATCH_RESULT_ALREADY_SUBMITTED";    // 409 — dubbele submit guard

export class MatchError extends Error {
  constructor(
    public code: MatchErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "MatchError";
  }
}
```

**Waarom 8 codes:** dekt 4 services + 1 helper (lockMatch). `MATCH_RESULT_ALREADY_SUBMITTED` is gescheiden van generieke `MATCH_INVALID_STATUS` om frontend specifieke "result already in" UI mogelijk te maken.

**`MATCH_NOT_IN_OPEN_POOL`:** ADR-0003 §2 eis — Match operaties (add, submit, delete) vereisen pool-status OPEN. Voor submitMatchResult wordt dit verfijnd tot `OPEN || CLOSED` (zie #4) zodat een al-CLOSED pool nog uitslagen kan ontvangen.

---

### 2. Bet-Match koppeling — `createBet` uitbreiding (Optie A)

P09's `createBet` accepteert al een optionele `matchId` parameter (zie `CreateBetInput.matchId?: string`). P12 doet alleen een **refinement**: de pool-status guard wordt scherper wanneer `matchId` is meegegeven.

**Huidige P09 gedrag:**
```typescript
// In createBet, na pool-existence check:
if (pool.status !== "OPEN") {
  throw new BetError("BET_INVALID_STATUS",
    `Pool not accepting bets (status=${pool.status})`, 409);
}
```

**P12 refinement:**
```typescript
if (pool.status !== "OPEN") {
  // matchId-context vraagt om scherper signaal — frontend kan
  // specifieke "match's pool is closed" UI tonen.
  if (matchId) {
    throw new BetError("BET_POOL_MATCH_NOT_OPEN",
      `match's pool is in status=${pool.status}, must be OPEN to attach bets`, 409);
  }
  throw new BetError("BET_INVALID_STATUS",
    `Pool not accepting bets (status=${pool.status})`, 409);
}
```

**Waarom geen aparte `addBetToMatch` service:**
- `createBet` is al de canonical entry point voor bet-creation. Splitsen in twee services zou twee parallel codepaths opleveren met overlap (idempotency-keys, ledger-hold, BetParticipant insert, etc.).
- `matchId` is technisch een metadata-veld op de Bet — niet een aparte lifecycle-stap. De relatie is "Bet is attached to Match" via FK; geen extra state-overgangen nodig.
- Wager pattern: `createBet` met optional context-fields. Eén entry, fan-out via params.

**Trade-off:** `createBet` wordt iets complexer (extra error code, refined guard). Gerechtvaardigd want het houdt de service-API minimaal.

---

### 3. `addMatchToPool` input + flow

```typescript
export interface AddMatchToPoolInput {
  poolId: string;
  callerId: string;
  title: string;
  description?: string;
  eventTime?: Date;
  idempotencyKey: string;
}

export interface AddMatchToPoolResult {
  match: Match;
}
```

Validatie:
- `assertUuidV4(idempotencyKey)`.
- `title.trim().length` in [1, 200].
- `description?.trim().length` ≤ 2000.
- `eventTime`, indien gezet, `> Date.now()` (anders MATCH_INVALID_INPUT — historic event-time is silly).

Flow (in `prisma.$transaction`):

```text
1. Idempotency replay-check via IdempotencyKey extended-shape:
   namespacedKey = `match-add:${idempotencyKey}`
   findUnique → if exists, parse responseJson { matchId } → return existing match.

2. lockPool(tx, poolId).
   Re-fetch pool via findUniqueOrThrow.

3. Guards:
   - pool.createdById === callerId → anders MATCH_NOT_OWNED_BY_POOL_CREATOR (403).
   - pool.status === "OPEN" → anders MATCH_NOT_IN_OPEN_POOL (409).

4. Insert Match:
   const match = await tx.match.create({
     data: {
       poolId,
       title: trimmedTitle,
       description: trimmedDescription ?? null,
       eventTime: eventTime ?? null,
       status: "SCHEDULED",
     }
   });

5. Insert IdempotencyKey row:
   scope = "match-add", userId = callerId,
   responseJson = { matchId: match.id }, expiresAt = now+24h.

6. Return { match }.
```

**Waarom `lockPool` ipv `lockMatch`:** Match bestaat nog niet bij add. Pool-row lock voorkomt dat Pool tussen-status-check en match-insert gemuteerd wordt (bv. concurrent `closePool` tijdens `addMatchToPool`).

**Geen check op `pool.bettingClosesAt`:** matches kunnen tot het laatste moment toegevoegd worden — operator kan bv. een laatste UFC-fight last-minute toevoegen zelfs vlak voor de deadline.

---

### 4. `submitMatchResult` input + flow (kern van P12)

```typescript
export interface SubmitMatchResultInput {
  matchId: string;
  callerId: string;
  winnerSide: "A" | "B";
  evidence?: Array<{
    type: "TEXT" | "URL" | "IMAGE" | "VIDEO";
    fileUrl?: string;
    mimeType?: string;
    contentHash: string;       // sha256 hex, 64 chars, caller computes
    description?: string;
  }>;
  idempotencyKey: string;
}

export interface SubmitMatchResultResult {
  match: Match;
  evidenceCount: number;
}
```

Validatie:
- `assertUuidV4(idempotencyKey)`.
- `winnerSide` is `"A"` of `"B"`. Geen `"VOID"`/`"DRAW"` — admin-VOID via dispute (P13).
- `evidence`, indien gezet, length ≤ 10 (defensive).
- Per evidence-item:
  - `type` in `["TEXT", "URL", "IMAGE", "VIDEO"]`.
  - `contentHash` matcht `/^[0-9a-f]{64}$/i` (sha256 hex).
  - `type === "TEXT"` → `fileUrl` MUST be undefined of null.
  - `type !== "TEXT"` → `fileUrl` MUST be a non-empty string.
  - `type === "IMAGE"` of `"VIDEO"` → `mimeType` SHOULD start with `"image/"` of `"video/"` respectively (best-effort).

Flow (in `prisma.$transaction`):

```text
1. Idempotency replay-check op `match-submit-result:${idempotencyKey}`.
2. lockMatch(tx, matchId).
3. Re-fetch Match + Pool (joined of separate findUnique).

4. Guards:
   - match.status === "SCHEDULED" → anders:
     - status === "RESULT_SUBMITTED" → MATCH_RESULT_ALREADY_SUBMITTED (409).
     - status === "SETTLED" of "DISPUTED" → MATCH_INVALID_STATUS (409).
   - pool.createdById === callerId → MATCH_NOT_OWNED_BY_POOL_CREATOR (403).
   - pool.status in ["OPEN", "CLOSED"] → anders MATCH_NOT_IN_OPEN_POOL (409).
     Comment: "CLOSED accepted want pool kan al gesloten zijn voor
              nieuwe bets, maar matches moeten nog gesettled worden".

5. updateMany Match met status-as-version:
   const submittedAt = new Date();
   const disputeWindowEndsAt = new Date(submittedAt.getTime() + 24 * 3600_000);
   const updated = await tx.match.updateMany({
     where: { id: matchId, status: "SCHEDULED" },
     data: {
       status: "RESULT_SUBMITTED",
       winnerSide,
       submittedAt,
       disputeWindowEndsAt,
     },
   });
   if (updated.count !== 1) {
     throw new MatchError("MATCH_VERSION_MISMATCH",
       `match ${matchId} concurrently mutated`, 409);
   }

6. Insert MatchEvidence rows. Per evidence-item:
   try {
     await tx.matchEvidence.create({
       data: {
         matchId,
         uploadedById: callerId,
         type: item.type,
         fileUrl: item.fileUrl ?? null,
         mimeType: item.mimeType ?? null,
         contentHash: item.contentHash,
         description: item.description ?? null,
       },
     });
   } catch (e) {
     if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
       // Duplicate contentHash for this match — silently skip.
       continue;
     }
     throw e;
   }

7. Count actual inserted evidence rows (after dedup):
   const evidenceCount = await tx.matchEvidence.count({ where: { matchId } });

8. IdempotencyKey row:
   scope = "match-submit-result",
   responseJson = { matchId, winnerSide, evidenceCount }.

9. Return { match: refetched, evidenceCount }.
```

**`SubmitMatchResult` doet geen bet-resolve.** Alleen status-overgang + evidence-write. Bet-resolve loopt via `autoResolveMatchBets` helper na disputeWindow-expiry (cron in P15, of admin-force in P13).

**Pool-status `CLOSED` accepted:** ADR-0003 §2 — een pool kan CLOSED worden voor nieuwe bets terwijl matches nog uitslag missen. Submit van resultaat op een CLOSED-pool is geldig.

**Evidence dedup via P2002 catch:** schema heeft `@@unique([matchId, contentHash])` (P08). Duplicate uploads zijn silent skip — de eerste insert wint, latere worden niet als error gerapporteerd. Frontend kan dit als best-effort dedup behandelen.

---

### 5. `autoResolveMatchBets` helper

```typescript
// src/lib/matches/auto-resolve.ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { settleBet } from "@/lib/bets/settlement";
import { lockMatch } from "./service";
import { MatchError } from "./errors";

export interface AutoResolveResult {
  resolvedCount: number;
  skippedCount: number;
}

export async function autoResolveMatchBets(
  matchId: string,
  options: { skipDisputeWindow?: boolean; actorId?: string | null } = {},
): Promise<AutoResolveResult> {
  const { skipDisputeWindow = false, actorId = null } = options;

  return await prisma.$transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });

    if (match.status === "SETTLED") {
      // Already done — idempotent return.
      return { resolvedCount: 0, skippedCount: 0 };
    }
    if (match.status !== "RESULT_SUBMITTED") {
      throw new MatchError("MATCH_INVALID_STATUS",
        `cannot auto-resolve from status=${match.status}`, 409);
    }
    if (!match.winnerSide) {
      throw new MatchError("MATCH_INVALID_STATUS",
        "match has no winnerSide set", 409);
    }
    if (!skipDisputeWindow) {
      if (!match.disputeWindowEndsAt || match.disputeWindowEndsAt > new Date()) {
        throw new MatchError("MATCH_INVALID_STATUS",
          `dispute window still open until ${match.disputeWindowEndsAt?.toISOString()}`,
          409);
      }
    }

    const pool = await tx.pool.findUniqueOrThrow({ where: { id: match.poolId } });
    const pickWinnerId = (b: { creatorSide: string; createdById: string; opponentUserId: string | null }): string => {
      if (!b.opponentUserId) {
        throw new Error(`bet ${b} has no opponentUserId — should be ACTIVE`);
      }
      return match.winnerSide === b.creatorSide ? b.createdById : b.opponentUserId;
    };

    const activeBets = await tx.bet.findMany({
      where: { matchId, status: "ACTIVE" },
    });

    let resolvedCount = 0;
    let skippedCount = 0;

    for (const bet of activeBets) {
      try {
        const winnerId = pickWinnerId(bet);
        await settleBet(tx, {
          bet,
          winnerId,
          ledgerIdempotencyKey: `bet-settle:${bet.id}`,
          fromStatus: "ACTIVE",
          actorId: actorId ?? pool.createdById,
        });
        resolvedCount++;
      } catch (e) {
        // Defensive: a single bet's settle failure should not block the
        // batch — the cron would retry. But within a tx, any throw rolls
        // back everything. So we let it bubble up.
        throw e;
      }
    }

    // Match → SETTLED.
    const updated = await tx.match.updateMany({
      where: { id: matchId, status: "RESULT_SUBMITTED" },
      data: { status: "SETTLED", settledAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new MatchError("MATCH_VERSION_MISMATCH",
        `match ${matchId} concurrently mutated`, 409);
    }

    return { resolvedCount, skippedCount };
  });
}
```

**WinnerId-logica:**
- `match.winnerSide === bet.creatorSide` → de creator was correct → `winnerId = bet.createdById`.
- Anders → opponent had het juiste side → `winnerId = bet.opponentUserId`.

**`skipDisputeWindow: true`:** bedoeld voor admin-force resolve (P13 dispute resolution kan een pool-creator's claim bevestigen voor expiry). Default `false` voor cron-pad.

**`actorId` parameter:** default `pool.createdById` als attribution voor de SETTLED transition. Cron kan `null` passeren → settleBet's `actorType` wordt `"SYSTEM"`.

**Geen pool auto-SETTLED transition in P12:** zie open Q3 — defer naar P15 cron of expliciete `settlePoolIfAllMatchesSettled` helper. P12 transitions alleen Match → SETTLED.

**`skippedCount` veld:** voorlopig altijd `0`. Reservering voor future "skip bets that have a pending dispute" logic in P13.

---

### 6. `deleteMatch` input + flow

```typescript
export interface DeleteMatchInput {
  matchId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface DeleteMatchResult {
  deleted: boolean;
}
```

Flow:

```text
1. Idempotency replay-check op `match-delete:${idempotencyKey}` — if exists,
   return { deleted: true } (response was recorded).
2. lockMatch(tx, matchId).
3. Re-fetch Match + Pool.
4. Guards:
   - pool.createdById === callerId → anders MATCH_NOT_OWNED_BY_POOL_CREATOR.
   - match.status === "SCHEDULED" → anders MATCH_INVALID_STATUS
     (RESULT_SUBMITTED/SETTLED/DISPUTED zijn niet deletable; gebruik
      dispute-flow voor undo).
   - bet count via tx.bet.count({where:{matchId}}) === 0 → anders
     MATCH_HAS_UNRESOLVED_BETS.
5. tx.match.delete({where:{id:matchId}}) — cascadeert MatchEvidence
   via @relation onDelete: Cascade in schema.
6. IdempotencyKey row:
   scope = "match-delete", responseJson = { deleted: true }.
7. Return { deleted: true }.
```

**Waarom alleen SCHEDULED:** RESULT_SUBMITTED/SETTLED/DISPUTED matches hebben "iets gebeurd" status; deletion zou audit-trail vernietigen. SETTLED bevat verwijzingen naar SETTLED bets die naar deze match wijzen via `bet.matchId`.

**`@relation onDelete: Cascade` op MatchEvidence:** uit P08 schema. `prisma.match.delete` triggert cascade automatically.

**Bet-count check:** defensive guard. Een SCHEDULED match zou via service-laag al geen bets moeten hebben *behalve* via createBet die de match als attached koos. Dat is wel toegestaan; daarom de check.

---

### 7. `lockMatch` helper — mirror van `lockBet`/`lockPool`

```typescript
export async function lockMatch(
  tx: TxClient,
  matchId: string,
): Promise<{ id: string }> {
  const rows = (await tx.$queryRaw`
    SELECT id FROM matches WHERE id = ${matchId} FOR UPDATE
  `) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new MatchError("MATCH_NOT_FOUND", `match ${matchId} not found`, 404);
  }
  return { id: rows[0].id };
}
```

`as Array<...>` cast pattern (consistent met P09/P11) om tsc-segfault op heavy template-literal generic types te vermijden.

`lockMatch` wordt geëxporteerd uit `src/lib/matches/service.ts` en geïmporteerd door `auto-resolve.ts`.

---

### 8. `settleBet` uitbreiding voor ACTIVE → SETTLED pad

```typescript
// src/lib/bets/settlement.ts EDIT:
export interface SettleBetInput {
  bet: Bet;
  winnerId: string;
  ledgerIdempotencyKey: string;
  fromStatus: "RESULT_PROPOSED" | "DISPUTED" | "ACTIVE"; // ← "ACTIVE" toegevoegd
  actorId: string | null;
}
```

Implementatie van `settleBet`:
- Geen wijziging aan ledger-flow (recordTransaction met SETTLEMENT_PAYOUT + FEE_COLLECTION).
- updateMany guard: `WHERE status: fromStatus` werkt automatisch met de nieuwe waarde.
- BetStateTransition row: `actorType` wordt `"POOL_CREATOR_RESOLVE"` als `fromStatus === "ACTIVE" && actorId !== null`. Anders behouden de bestaande logica:
  ```typescript
  let actorType: string;
  if (fromStatus === "ACTIVE" && actorId !== null) {
    actorType = "POOL_CREATOR_RESOLVE";
  } else if (actorId === null) {
    actorType = "SYSTEM";
  } else {
    actorType = "USER";
  }
  ```

**Waarom `"POOL_CREATOR_RESOLVE"` als nieuwe actorType-string:** semantische scheiding van P10's confirmResult-pad (`"USER"`) en cron-pad (`"SYSTEM"`). Frontend/admin-tools kunnen via deze tag onderscheid maken: "deze bet is via match-result resolved, niet via individuele claim/confirm".

**`actorType` is een vrij `String` field** in de schema (`BetStateTransition.actorType`); geen enum constraint. Toevoegen van `"POOL_CREATOR_RESOLVE"` is geen schema-mutatie.

**Backward compat voor P10 callers:** `confirmResult` calt `settleBet` met `fromStatus: "RESULT_PROPOSED"` — onveranderd, blijft werken.

---

### 9. `BET_POOL_MATCH_NOT_OPEN` — nieuwe error code in `bets/errors.ts`

```typescript
// src/lib/bets/errors.ts EDIT:
export type BetErrorCode =
  | "BET_NOT_FOUND" | "BET_NOT_OWNED_BY_CALLER" | "BET_INVALID_STATUS"
  | "BET_INVITE_INVALID" | "BET_ALREADY_ACCEPTED" | "BET_EXPIRED"
  | "BET_INSUFFICIENT_BALANCE" | "BET_VERSION_MISMATCH"
  | "BET_INVALID_INPUT" | "BET_CREATOR_BETTING_OWN_POOL"
  | "BET_NOT_PARTICIPANT" | "BET_RESULT_ALREADY_CLAIMED"
  | "BET_RESULT_CLAIM_NOT_FOUND" | "BET_CONFIRM_BY_CLAIMANT"
  | "BET_DEADLINE_PASSED" | "BET_SETTLEMENT_LEDGER_ERROR"
  | "BET_POOL_MATCH_NOT_OPEN";  // ← nieuw, P12
```

**Wanneer gegooid:** `createBet` met `matchId` set + `pool.status !== "OPEN"`. HTTP 409.

**Niet gebruikt voor `poolId` zonder `matchId`:** dat scenario blijft `BET_INVALID_STATUS`. Reden: caller die alleen poolId passt is in een andere flow (mogelijk pool-zonder-matches betting), en de message is generiek genoeg. Caller die expliciet matchId zet vraagt om match-context — krijgt match-context error.

---

### 10. `createBet` matchId-pad refinement

In `src/lib/bets/service.ts` `createBet` flow stap 4 (pool/match async validatie):

```typescript
// Voor:
if (pool.status !== "OPEN") {
  throw new BetError("BET_INVALID_STATUS",
    `Pool not accepting bets (status=${pool.status})`, 409);
}

// Na (P12 refinement):
if (pool.status !== "OPEN") {
  if (matchId) {
    throw new BetError("BET_POOL_MATCH_NOT_OPEN",
      `match's pool is in status=${pool.status}, must be OPEN to attach bets`,
      409);
  }
  throw new BetError("BET_INVALID_STATUS",
    `Pool not accepting bets (status=${pool.status})`, 409);
}
```

Geen wijzigingen aan `match.status` check (al `SCHEDULED` required) of trigger-error wrap (`bets_creator_cannot_bet_on_own_pool_match` blijft hard-guard).

---

### 11. Idempotency strategie samenvatting (P12 services)

| Service | Namespaced key | Scope | responseJson |
|---|---|---|---|
| `addMatchToPool` | `match-add:{idempotencyKey}` | `"match-add"` | `{ matchId }` |
| `submitMatchResult` | `match-submit-result:{idempotencyKey}` | `"match-submit-result"` | `{ matchId, winnerSide, evidenceCount }` |
| `deleteMatch` | `match-delete:{idempotencyKey}` | `"match-delete"` | `{ deleted: true }` |
| `autoResolveMatchBets` | *n/a — server-only helper, geen caller-key* | natural-DB-state idempotency via Match.status check | (geen) |

Hergebruik `IDEMPOTENCY_TTL_MS` constant uit `src/lib/pools/service.ts` — single source of truth voor TTL.

`autoResolveMatchBets` is idempotent door **status-check**: als Match.status === SETTLED → return `{ resolvedCount: 0, skippedCount: 0 }`. Geen IdempotencyKey row geschreven. Race-veilig dankzij FOR UPDATE op Match-row.

---

### 12. Test structuur — 22 tests verdeeld over 2 files

**File 1: `src/__tests__/matches/match-lifecycle.test.ts`** (12 tests)

#### addMatchToPool (4)

- **a. Happy path** — published Pool, pool-creator add Match → Match SCHEDULED, pool-FK correct, IdempotencyKey row scope `match-add`, responseJson `{ matchId }`.
- **b. Pool not OPEN (DRAFT)** — addMatchToPool op DRAFT pool → MATCH_NOT_IN_OPEN_POOL.
- **c. Non-creator** — addMatchToPool by stranger → MATCH_NOT_OWNED_BY_POOL_CREATOR (403).
- **d. Idempotent replay** — twee `addMatchToPool` calls met zelfde key → tweede returnt zelfde match. Eén Match row, één IdempotencyKey row.

#### submitMatchResult (5)

- **a. Happy path** — addMatchToPool → submitMatchResult `winnerSide: "A"` → Match RESULT_SUBMITTED, `submittedAt` gezet, `disputeWindowEndsAt` ~now+24h.
- **b. Multi-evidence (text + URL + image)** — submit met 3 evidence items, één duplicate contentHash → na write: 3 unique MatchEvidence rows (4e is dedup-skipped). `evidenceCount` in resultJson = 3.
- **c. Non-pool-creator** — submitMatchResult by stranger → MATCH_NOT_OWNED_BY_POOL_CREATOR.
- **d. Already RESULT_SUBMITTED** — submit twee keer met *verschillende* idempotency keys → tweede call MATCH_RESULT_ALREADY_SUBMITTED.
- **e. winnerSide invalid** — `winnerSide: "C"` → MATCH_INVALID_INPUT.

#### deleteMatch (3)

- **a. Happy path SCHEDULED zonder bets** — addMatchToPool → deleteMatch → match weg + cascadeert evidence (insert eerst evidence dan delete: na delete count=0).
- **b. Match met attached bet** — match heeft een Bet via createBet(matchId): deleteMatch → MATCH_HAS_UNRESOLVED_BETS.
- **c. Match SETTLED** — submitMatchResult + autoResolveMatchBets first, dan deleteMatch → MATCH_INVALID_STATUS.

**File 2: `src/__tests__/matches/match-result.test.ts`** (10 tests)

#### autoResolveMatchBets (6)

- **a. Happy path 3 bets winnerSide="A"** — 3 bettors creëren bets met `creatorSide: "A"` (allen claimen A wint), opponents accepten (krijgen "B"). submitMatchResult winner="A". skipDisputeWindow=true (force resolve).
  - Asserts: alle 3 bets SETTLED, `bet.winnerId === bet.createdById`, ledger transacties = 3× SETTLEMENT_PAYOUT + 3× FEE_COLLECTION (= 6 LedgerEntry rows). Treasury balance steeg met 3 × 2% × 2 × stake.
- **b. Mix winners** — 2 bets met `creatorSide: "A"`, 1 bet met `creatorSide: "B"`. winnerSide="A".
  - Asserts: bets met creator-side A → winnerId = createdById (creator wint). Bet met creator-side B → winnerId = opponentUserId (opponent wint).
- **c. skipDisputeWindow=true admin force** — submitMatchResult, *direct* autoResolveMatchBets met `skipDisputeWindow: true` (zonder 24h wachten) → werkt, all SETTLED.
- **d. disputeWindow nog open + skipDisputeWindow=false** — submitMatchResult, `disputeWindowEndsAt` = now + 24h (default), call autoResolveMatchBets zonder skip → MATCH_INVALID_STATUS met message "dispute window still open until ...".
- **e. Match heeft 0 bets** — submitMatchResult op Match zonder bets, autoResolveMatchBets (skip=true) → `resolvedCount: 0`, Match.status = SETTLED.
- **f. Race / replay** — autoResolveMatchBets twee keer (skip=true) op zelfde match. Eerste: resolvedCount > 0. Tweede: status=SETTLED detected → returns `{ resolvedCount: 0, skippedCount: 0 }` zonder error.

#### Edge cases (4)

- **a. createBet met matchId pad** — addMatchToPool (Pool by user A, Match in Pool), createBet by user B (≠A) met `poolId: pool.id, matchId: match.id` → bet aangemaakt, `bet.poolId === pool.id`, `bet.matchId === match.id`. Trigger heeft niet gefired (B is geen pool-creator).
- **b. createBet met matchId van CLOSED pool** — Pool published → CLOSED via closePool → createBet met poolId+matchId → BET_POOL_MATCH_NOT_OPEN (409).
- **c. settleBet ACTIVE → SETTLED via auto-resolve** — verifiëer dat een individuele Bet via auto-resolve een BetStateTransition row krijgt met `fromStatus: "ACTIVE"`, `toStatus: "SETTLED"`, `actorType: "POOL_CREATOR_RESOLVE"`.
- **d. Treasury fee aggregation correct na 5 bets** — 5 ACTIVE bets met stake 50 USDC → autoResolveMatchBets. Treasury balance moet 5 × 2_000_000n = 10_000_000n stijgen.

---

### 13. Test infrastructure helpers

```typescript
const SUFFIX = `match-${Date.now()}`;
const PRIVY_PREFIX = `mr-${SUFFIX}-`;
const testUserIds: string[] = [];

async function makeUser(label: string, fundUnits: bigint = 200_000_000n) {
  /* identical to bet-settlement.test.ts pattern */
}

async function createPublishedPool(creator: User): Promise<Pool> {
  const created = await createPool({
    creatorId: creator.id,
    title: `Pool ${SUFFIX} ${crypto.randomUUID()}`,
    bettingClosesAt: new Date(Date.now() + 48 * 3600_000),
    idempotencyKey: crypto.randomUUID(),
  });
  const published = await publishPool({
    poolId: created.pool.id,
    callerId: creator.id,
    idempotencyKey: crypto.randomUUID(),
  });
  return published.pool;
}

async function addScheduledMatch(pool: Pool, creator: User, label: string = "Match"): Promise<Match> {
  const r = await addMatchToPool({
    poolId: pool.id,
    callerId: creator.id,
    title: `${label} ${SUFFIX}`,
    idempotencyKey: crypto.randomUUID(),
  });
  return r.match;
}

async function createPoolBet(
  match: Match,
  creator: User,
  opponent: User,
  side: "A" | "B" = "A",
  stake: bigint = 50_000_000n,
): Promise<Bet> {
  const created = await createBet({
    creatorId: creator.id,
    creatorSide: side,
    stakeUnits: stake,
    expiresInHours: 48,
    poolId: match.poolId,
    matchId: match.id,
    idempotencyKey: crypto.randomUUID(),
  });
  const accepted = await acceptBet({
    opponentUserId: opponent.id,
    inviteToken: created.inviteToken!,
    idempotencyKey: crypto.randomUUID(),
  });
  return accepted.bet;
}

async function fullCleanup() {
  await prisma.betStateTransition.deleteMany({});
  await prisma.betParticipantConfirmation.deleteMany({});
  await prisma.betResultClaim.deleteMany({});
  await prisma.betEvidence.deleteMany({});
  await prisma.betParticipant.deleteMany({});
  await prisma.betInvite.deleteMany({});
  await prisma.bet.deleteMany({});
  await prisma.matchEvidence.deleteMany({});  // NEW table to clean
  await prisma.match.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.idempotencyKey.deleteMany({
    where: {
      OR: [
        { scope: { startsWith: "pool-" } },
        { scope: { startsWith: "match-" } },
      ],
    },
  });
  if (testUserIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        OR: [
          { transaction: { initiatorUserId: { in: testUserIds } } },
          { debitAccount: { scopeKey: { startsWith: "bet:" } } },
          { creditAccount: { scopeKey: { startsWith: "bet:" } } },
        ],
      },
    });
    await prisma.ledgerTransaction.deleteMany({
      where: {
        OR: [
          { initiatorUserId: { in: testUserIds } },
          { refType: "bet" },
        ],
      },
    });
  }
  await prisma.financialAccount.deleteMany({
    where: {
      OR: [
        { userId: { in: testUserIds } },
        { scopeKey: { startsWith: "bet:" } },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: { privyId: { startsWith: PRIVY_PREFIX } },
  });
  // Reset treasury+external balance to keep schema-test green.
  await prisma.financialAccount.updateMany({
    where: { scopeKey: { in: ["treasury", "external"] } },
    data: { balanceUnits: 0n },
  });
}
```

**Cleanup volgorde respect FK chain:** matchEvidence → match → pool (matches has FK to pool with onDelete: Cascade, but explicit clean is safer for ordering).

**`scope startsWith "match-" OR "pool-"`:** beide IdempotencyKey scopes worden geschoond. Geen impact op P05/P06 deposit/withdrawal idempotency rows van andere test files.

---

## ── BEGIN PROMPT — uitvoering ──

You are extending zentrix met de Match management + result-submission services voor refactor fase 5. **De single most important rule:** `submitMatchResult` doet GEEN bet-resolve; alleen status-overgang naar RESULT_SUBMITTED. `autoResolveMatchBets` (apart helper) gebruikt P10's `settleBet` om alle ACTIVE bets per match te SETTLEN. Settleben loopt via één canonical helper — geen duplicate ledger-code.

**Hard constraints:**
- Geen ledger writes in `submitMatchResult`. Alleen status + evidence.
- `autoResolveMatchBets` in `auto-resolve.ts`, niet in `service.ts` (separate concern).
- `settleBet.fromStatus` union breidt uit met `"ACTIVE"`. P10 callers blijven werken.
- `actorType` voor ACTIVE→SETTLED pad is `"POOL_CREATOR_RESOLVE"` (nieuwe string).
- Pre-existing trigger `bets_creator_cannot_bet_on_own_pool_match` blijft hard-guard — geen wijziging.
- IdempotencyKey hergebruikt `IDEMPOTENCY_TTL_MS` uit `pools/service.ts`.

---

### Step 0 — Pre-flight

```bash
cd ~/zentrix
git status                                       # clean
git log --oneline -1                             # 216598d (refactor-fase-4)
git tag -l | grep refactor-fase-4                # bestaat
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  104 passed (104)"
ls src/lib/matches 2>&1
# Verwacht: "No such file or directory"
```

Stop bij rood.

---

### Step 1 — `src/lib/matches/errors.ts`

Maak nieuw bestand met `MatchError` class + 8-code union per #1. Mirror `PoolError`/`BetError` style.

Sanity:
```bash
grep -cE "\"MATCH_(NOT_FOUND|NOT_IN_OPEN_POOL|NOT_OWNED_BY_POOL_CREATOR|INVALID_STATUS|INVALID_INPUT|VERSION_MISMATCH|HAS_UNRESOLVED_BETS|RESULT_ALREADY_SUBMITTED)\"" src/lib/matches/errors.ts
# Verwacht: 8
```

---

### Step 2 — `src/lib/matches/service.ts` — `lockMatch` + `addMatchToPool`

Implementeer:
1. Constants + interfaces (`AddMatchToPoolInput/Result`, `SubmitMatchResultInput/Result`, `DeleteMatchInput/Result`, helpers).
2. `lockMatch` per #7.
3. `assertUuidV4` helper, `findReplayedMatch` (mirror `findReplayedPool` van P11), `recordMatchIdempotency`.
4. `addMatchToPool` per #3.

Importeer `IDEMPOTENCY_TTL_MS` uit `@/lib/pools/service`. Importeer `lockPool` uit `@/lib/pools/service`.

Sanity na write:
```bash
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm typecheck
```

Bij segfault: `rm -f tsconfig.tsbuildinfo` + retry.

---

### Step 3 — `src/lib/matches/service.ts` — `submitMatchResult` + `deleteMatch`

Voeg toe aan zelfde file: `submitMatchResult` per #4, `deleteMatch` per #6.

Sanity: typecheck + grep counts.

---

### Step 4 — `src/lib/bets/settlement.ts` — uitbreiding voor ACTIVE fromStatus

Edit:
1. `SettleBetInput.fromStatus` union: voeg `"ACTIVE"` toe.
2. `actorType` switch (zie #8 implementatie):
   ```typescript
   let actorType: string;
   if (fromStatus === "ACTIVE" && actorId !== null) {
     actorType = "POOL_CREATOR_RESOLVE";
   } else if (actorId === null) {
     actorType = "SYSTEM";
   } else {
     actorType = "USER";
   }
   ```

Sanity: bestaande P10-tests moeten nog steeds groen blijven (run alleen bet-settlement.test.ts).

---

### Step 5 — `src/lib/matches/auto-resolve.ts`

Maak nieuw bestand met `autoResolveMatchBets` helper + `AutoResolveResult` interface per #5.

Imports:
- `prisma` uit `@/lib/prisma`.
- `settleBet` uit `@/lib/bets/settlement`.
- `lockMatch` uit `./service`.
- `MatchError` uit `./errors`.

---

### Step 6 — `src/lib/bets/errors.ts` — voeg `BET_POOL_MATCH_NOT_OPEN` toe

Edit per #9. Een regel toevoegen aan de union.

Sanity:
```bash
grep -c "\"BET_POOL_MATCH_NOT_OPEN\"" src/lib/bets/errors.ts
# Verwacht: 1
```

---

### Step 7 — `src/lib/bets/service.ts` — refine matchId-pad

Edit per #10. Pool-status guard verfijnd voor matchId-context.

Sanity: typecheck + bet-lifecycle.test.ts moet nog groen (bestaande tests gebruiken niet de nieuwe error code).

---

### Step 8 — Tests — `match-lifecycle.test.ts` + `match-result.test.ts`

Maak beide test files per #12 + #13. Volgorde van schrijven:
1. Helpers (`makeUser`, `createPublishedPool`, `addScheduledMatch`, `createPoolBet`, `fullCleanup`).
2. `match-lifecycle.test.ts`: addMatchToPool 4 → submitMatchResult 5 → deleteMatch 3 = 12 tests.
3. `match-result.test.ts`: autoResolveMatchBets 6 → edge cases 4 = 10 tests.

Per groep run:
```bash
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm vitest run src/__tests__/matches/
```

---

### Step 9 — Volledige validatie

```bash
rm -f tsconfig.tsbuildinfo
pnpm prisma format
pnpm prisma validate
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm typecheck
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test
# Verwacht totaal: 104 + 22 = 126 tests passed.
```

WSL flake retry per ervaring P09/P10/P11: 1× herhalen lost typecheck-segfault op.

---

### Step 10 — Commit + tag + push

```bash
git add src/lib/matches/errors.ts \
        src/lib/matches/service.ts \
        src/lib/matches/auto-resolve.ts \
        src/lib/bets/errors.ts \
        src/lib/bets/service.ts \
        src/lib/bets/settlement.ts \
        src/__tests__/matches/match-lifecycle.test.ts \
        src/__tests__/matches/match-result.test.ts

git status

git commit -m "$(cat <<'COMMIT_MSG'
feat(matches): match management + result submission + auto-resolve (PROMPT_12, refactor fase 5)

Implementeert Match-laag bovenop Pool services per ADR-0003 §2 en
REFACTOR_PLAN fase 5.

Services:
- addMatchToPool: pool creator voegt SCHEDULED Match toe aan OPEN Pool.
  Title 1-200, description optional, eventTime optional.
- submitMatchResult: pool creator zet winnerSide ("A"|"B") + optionele
  evidence (text/url/image/video). Match -> RESULT_SUBMITTED,
  disputeWindowEndsAt = now + 24h. Geen bet-resolve hier (komt via
  autoResolveMatchBets na disputeWindow expiry).
- deleteMatch: alleen SCHEDULED matches zonder attached bets.
- autoResolveMatchBets (helper, niet exposed): na disputeWindow-expiry
  (of admin-force met skipDisputeWindow=true) — alle ACTIVE bets op
  Match SETTLED via settleBet helper uit P10. Match -> SETTLED.
  Idempotent door status-check (al-SETTLED match returns 0).

Helpers:
- lockMatch (FOR UPDATE row lock, mirror van lockBet/lockPool).
- MatchError class + 8-code union (MATCH_NOT_FOUND, MATCH_NOT_IN_OPEN_POOL,
  MATCH_NOT_OWNED_BY_POOL_CREATOR, MATCH_INVALID_STATUS, MATCH_INVALID_INPUT,
  MATCH_VERSION_MISMATCH, MATCH_HAS_UNRESOLVED_BETS,
  MATCH_RESULT_ALREADY_SUBMITTED).

Edits aan bestaande modules:
- bets/errors.ts: +BET_POOL_MATCH_NOT_OPEN (16 -> 17 codes).
- bets/service.ts createBet matchId-pad: BET_POOL_MATCH_NOT_OPEN voor
  pool-not-OPEN error wanneer matchId is meegegeven (scherper signaal
  voor frontend dan generieke BET_INVALID_STATUS).
- bets/settlement.ts settleBet: fromStatus union breidt uit met "ACTIVE"
  voor pool-match auto-resolve. actorType="POOL_CREATOR_RESOLVE" wanneer
  fromStatus="ACTIVE" + actorId set. P10 callers blijven werken.

Idempotency:
- match-add, match-submit-result, match-delete via IdempotencyKey
  extended-shape (P11 pattern).
- autoResolveMatchBets server-only helper met natural status-check
  idempotency (Match.status === SETTLED -> return 0).
- Hergebruikt IDEMPOTENCY_TTL_MS uit pools/service.ts.

Design constraints:
- submitMatchResult doet GEEN bet-resolve (separation of concerns).
- autoResolveMatchBets in apart bestand auto-resolve.ts (P13 dispute
  resolution kan hem ook aanroepen).
- Geen pool auto-SETTLED transition in P12 (gedeferd naar P15 cron).
- Trigger bets_creator_cannot_bet_on_own_pool_match blijft hard-guard.

Tests (22 nieuwe, 2 files):
- match-lifecycle.test.ts (12): 4 addMatch + 5 submitResult + 3 deleteMatch.
- match-result.test.ts (10): 6 autoResolve + 4 edge (createBet matchId
  pad, BET_POOL_MATCH_NOT_OPEN, settleBet ACTIVE-pad, treasury fee
  aggregation).

Test count: 104 -> 126.

Pre-PROMPT_13 (Dispute services).
Reference: ADR-0003 (e9fc0c5), REFACTOR_PLAN (7fc4bbb), P08 schema (1618b27),
P09 lifecycle (c48927c), P10 settlement (7496fa9), P11 pools (216598d),
P12 spec (xxxxxxx).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT_MSG
)"

git tag refactor-fase-5
git log --oneline -5
git push origin main
git push origin refactor-fase-5
```

Replace `xxxxxxx` met de spec-commit hash.

---

## Post-flight checks

```bash
# 1. Service exports
grep -E "^export (async )?function (addMatchToPool|submitMatchResult|deleteMatch|lockMatch)\b" src/lib/matches/service.ts
# Verwacht: 4 matches

grep -E "^export (async )?function autoResolveMatchBets\b" src/lib/matches/auto-resolve.ts
# Verwacht: 1 match

# 2. Geen ledger imports in submitMatchResult
grep -nE "recordTransaction" src/lib/matches/service.ts
# Verwacht: niets — alleen auto-resolve.ts mag indirect via settleBet.

# 3. settleBet ACTIVE pad
grep -E "fromStatus.*\"ACTIVE\"" src/lib/bets/settlement.ts
# Verwacht: minstens 1 match in interface + één in actorType-switch logic.

# 4. autoResolveMatchBets gebruikt settleBet
grep -c "settleBet" src/lib/matches/auto-resolve.ts
# Verwacht: minstens 1.

# 5. Test count
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep "Tests"
# Verwacht: "Tests  126 passed (126)"

# 6. Trigger nog actief (sanity)
pnpm prisma db execute --schema=prisma/schema.prisma --stdin <<<"SELECT tgname FROM pg_trigger WHERE tgname = 'bets_creator_cannot_bet_on_own_pool_match';"
# Verwacht: 1 row.

# 7. Geen hardcoded fee numbers in match-result code
grep -nE "(200|2_000_000|10000)" src/lib/matches/auto-resolve.ts
# Verwacht: alleen via settleBet-import (settleBet zelf gebruikt FEES.PLATFORM_BPS).
```

---

## Wat dit NIET doet

- **Geen match dispute services.** `openMatchDispute`, `resolveMatchDispute` (waar bettor de pool-creator's submit betwist) komen **PROMPT_13**. P12 zet alleen `disputeWindowEndsAt`; bettor-dispute-flow leeft in P13.
- **Geen pool auto-SETTLED transition.** Wanneer alle Matches in een Pool SETTLED zijn, transitioneert de Pool zelf NIET automatisch in P12. P12 stopt bij Match → SETTLED; Pool blijft op `OPEN` of `CLOSED` status. **P15-cron-scope:** zal `settlePoolIfAllMatchesSettled(poolId)` helper toevoegen die periodiek pools controleert en CLOSED-pools met alle-matches-SETTLED transitioneert naar `SETTLED`. ADR-0003 §2 status-graph (`DRAFT → OPEN → CLOSED → SETTLED`) wordt zo compleet, maar pas in P15.
- **Geen reputation impact.** UserReputation-snapshots bij match-result/dispute komen **PROMPT_14**.
- **Geen cron voor disputeWindow-expiry.** P15. Tot P15: `autoResolveMatchBets` is een direct-callable helper (testen + admin-tools).
- **Geen HTTP routes.** `POST /api/pools/:id/matches`, `POST /api/matches/:id/result`, `DELETE /api/matches/:id` komen **PROMPT_16**.
- **Geen UI / file-upload integratie.** Evidence `contentHash` is caller-supplied — frontend computeert sha256 vóór POST. Storage layer (S3/R2) komt P17+.
- **Geen ARBITER_REQUIRED of AUTO_VERIFY settlement modes.** ADR-0003 explicit out-of-MVP.
- **Geen schema migrations.** P12 leunt op P08; geen wijzigingen aan `prisma/schema.prisma`.
- **Geen draws (pool/match outcome "tie").** `winnerSide` is `"A" | "B"` — admin-VOID via P13 dispute is enige uitweg uit gelijkspel.

---

## Volgende stap

Na user-akkoord op deze spec:
- **Stop voor review.** User leest dit document en geeft groen licht of correcties.
- **Daarna uitvoeren** in een latere Claude Code sessie via Steps 0-10.
- Bij groen Step 9: fase 5 commit + tag + push, dan PROMPT_13 spec schrijven (Dispute services: openDispute, resolveDispute, evidence handling).

---

## Beslissingen op open questions

Vier punten besproken; alle vier vastgelegd op 2026-05-08.

### Q1 — `createBet(matchId?)` als enige entry point (AKKOORD)

P12 hergebruikt P09's bestaande `createBet(matchId?)` parameter. Geen aparte `addBetToMatch` service. Refinement: nieuwe error code `BET_POOL_MATCH_NOT_OPEN` voor scherper signaal wanneer pool niet OPEN is bij match-attached create. `createBet` blijft canonical entry point voor bet-creation; matchId is metadata-veld, geen aparte lifecycle-stap.

### Q2 — `settleBet.fromStatus` union uitbreiden met `"ACTIVE"` (AKKOORD)

`SettleBetInput.fromStatus` wordt 3-waarde union (`"RESULT_PROPOSED" | "DISPUTED" | "ACTIVE"`). Eén canonical settle-helper voor alle paden. Differentiatie via `actorType` op de BetStateTransition row (`"POOL_CREATOR_RESOLVE"` voor ACTIVE-pad). Geen duplicate ledger-code in `auto-resolve.ts`. P10's bestaande `confirmResult` caller blijft werken — backward-compatible TS union expansion.

### Q3 — Pool auto-SETTLED transition: gedeferd naar P15 (AKKOORD)

P12 stopt bij Match → SETTLED. Pool blijft op `OPEN` of `CLOSED` status, ook al zijn alle matches SETTLED. P15 cron-prompt zal een `settlePoolIfAllMatchesSettled(poolId)` helper toevoegen die periodiek CLOSED-pools controleert en transitioneert naar `SETTLED`. ADR-0003 §2 status-graph (`DRAFT → OPEN → CLOSED → SETTLED`) wordt zo compleet, maar pas in P15. Spec impact: "Wat dit NIET doet" sectie aangepast met expliciete P15-scope note.

### Q4 — `submitMatchResult` accepteert pool status OPEN+CLOSED (AKKOORD)

Pool kan al gesloten zijn voor nieuwe Match/Bet additions terwijl bestaande matches nog uitspeelt — realistisch operator-scenario (bv. "rondes 1-3 ingeschreven, ronde 1 wedstrijden lopen na close"). `submitMatchResult` accepteert `pool.status in ["OPEN", "CLOSED"]` voor deze flexibiliteit. Strict OPEN-only zou operator dwingen om alle matches te resolven vóór `closePool`-aanroep — niet operator-vriendelijk.

---

Spec is uitvoeringsklaar. Wachten op final akkoord voor Step 0 start.
