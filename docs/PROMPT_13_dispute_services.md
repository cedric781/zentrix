# PROMPT_13 — Dispute services + admin resolve

**Refactor fase 6 deliverable.** Dispute-laag bovenop bet/match settlement uit P10/P12. Conform [ADR-0003](./ADR-0003-1v1-with-tournament-pools.md) §4 (Dispute mechanism: opener-only deposit, fail-closed lock, admin-decided outcome) en [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) §4 (PROMPT_13 scope).

**Status:** Approved 2026-05-10. Open Qs §10 gelocked door user, ready for step 0 pre-flight. **Géén** schema mutaties in deze prompt.

---

## Doel

Implementeer dispute services voor 1v1 bets (stand-alone én pool-attached):

- `openDispute` — bet participant opent een dispute met 10%-deposit fail-closed (ADR §4 punt 1+2).
- `submitDisputeEvidence` — bet participant voegt evidence toe aan een open dispute (`EVIDENCE_PHASE`).
- `resolveDispute` — admin beslist outcome (`CREATOR_WINS | OPPONENT_WINS | VOID`) en triggert payout / deposit handling.
- `forceCancelBet` — admin emergency-cancel van een vastzittende bet (geen dispute-flow, pure operator override).

Plus: `lockDispute` helper (mirror van `lockBet`/`lockMatch`/`lockPool`).

**Niet** in scope (volgt in latere fasen):
- `UserReputation` snapshots na resolve (win/lose counts, tier-update) — komt **PROMPT_14**.
- Cron voor expired-window auto-cleanup van `OPEN` disputes zonder evidence-actie — komt **PROMPT_15**.
- HTTP routes (`POST /api/disputes`, `POST /api/disputes/:id/evidence`, `POST /api/disputes/:id/resolve`) — komen **PROMPT_16**.
- Admin UI — komt **PROMPT_17+**.
- `dispute-abuse-prevention` (rate limit, escalated deposit voor recidivisten) — komt **PROMPT_14** samen met reputation.
- Schema-uitbreidingen (extra DisputeOutcome enum-waardes, `DisputeEvidence` tabel, `Dispute.matchId`, `User.role`) — buiten scope, zie §10 (Open Questions) voor de divergenties die de eerdere briefing veronderstelde.

Test count target na P13: 126 → **~144** (~18 nieuwe dispute-tests; lager dan de oorspronkelijke briefing-schatting van +22 omdat de schema slechts 3 outcomes ondersteunt, niet 6).

---

## Builds on

- **PROMPT_07** ledger — `recordTransaction`, `getUserAccount`, `getTreasuryAccount`, `getOrCreateBetEscrowAccount` patroon. Dispute deposit reuses dezelfde `BET_ESCROW` `AccountType` met aparte `scopeKey` (zie §3 in Beslissingen).
- **PROMPT_08** schema (commit `1618b27`) — `Dispute` model (id, betId, openedById, reason, depositLedgerTxId?, status, outcome?, resolvedById?, resolvedAt?, adminNotes?), `DisputeStatus` enum (4 waardes), `DisputeOutcome` enum (3 waardes), `BetEvidence` met `@@unique([betId, contentHash])` dedup. `User.role` bestaat **niet** — admin gating via env (zie §2).
- **PROMPT_09** (commit `c48927c`) — `BetError` class + 17-code union, `lockBet` helper. Dispute opens lockt de target bet voordat status muteert.
- **PROMPT_10** (commit `7496fa9`) — `settleBet` helper in `src/lib/bets/settlement.ts`. P13 hergebruikt dit voor `CREATOR_WINS`/`OPPONENT_WINS` outcomes. **Belangrijk:** P13 voegt een `feeOverrideBps?: number` parameter toe zodat de 15% dispute-resolution fee de 2% platform fee kan vervangen (ADR §3: dispute fee replaces, does not stack). Zie §8.
- **PROMPT_11** (commit `216598d`) — `IDEMPOTENCY_TTL_MS` constant, idempotency-pattern via `IdempotencyKey` extended-shape (`userId + key + scope + responseJson + expiresAt`).
- **PROMPT_12** (commit `6ff2031`) — `MatchError`, `lockMatch`, `autoResolveMatchBets({skipDisputeWindow})` helper. P13 muteert `Match.status → DISPUTED` wanneer een bet op een pool-attached match een dispute opent (zie §6).
- **ADR-0003 §4** (Dispute mechanism) — opener-only deposit (10% min $0.50), fail-closed lock, admin decides outcome, uitkomst-set is `CREATOR_WINS | OPPONENT_WINS | VOID` (geen SPLIT/ABUSE/INVALID — zie §10 open Q1).
- **ADR-0003 §3** (Fees) — `FEES.DISPUTE_DEPOSIT_BPS = 1000` (10%), `FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS = 500_000n` ($0.50), `FEES.DISPUTE_RESOLUTION_BPS = 1500` (15%, vervangt platform fee bij dispute-settled bet).

---

## Files touched

| File | Mutatie | Omvang |
|---|---|---|
| `src/lib/disputes/errors.ts` | NEW — `DisputeError` class + 11-code union | ~40 regels |
| `src/lib/disputes/escrow.ts` | NEW — `getOrCreateDisputeEscrowAccount(tx, disputeId)` race-safe lazy create (mirror van bets/escrow.ts) | ~40 regels |
| `src/lib/disputes/admin.ts` | NEW — `isAdmin(userId): boolean` env-gated helper (parses `ADMIN_USER_IDS` env var) | ~25 regels |
| `src/lib/disputes/service.ts` | NEW — `lockDispute` + `openDispute` + `submitDisputeEvidence` + `resolveDispute` + `forceCancelBet` | ~600 regels |
| `src/lib/bets/settlement.ts` | EDIT — voeg optionele `feeOverrideBps?: number` toe aan `SettleBetInput`. Default = `FEES.PLATFORM_BPS`. Override gebruikt voor dispute-settled bets (15%). Backward compatible. | ~6 regels diff |
| `src/lib/env.ts` | EDIT — voeg `ADMIN_USER_IDS: z.string().optional()` toe (comma-separated UUIDs). Geen secret, mag in `.env`. | ~3 regels diff |
| `src/__tests__/disputes/dispute-lifecycle.test.ts` | NEW — 8 tests: openDispute (4) + submitDisputeEvidence (4) | ~480 regels |
| `src/__tests__/disputes/dispute-resolve.test.ts` | NEW — 10 tests: resolveDispute per outcome (6) + forceCancelBet (3) + admin gating (1) | ~520 regels |

**Geen** schema-mutaties, **geen** Prisma migrations. P13 leunt volledig op P08-schema. Alle voorgestelde schema-uitbreidingen uit de oorspronkelijke briefing zijn gedetailleerd in §10 (Open Questions) en wachten op user-beslissing.

**Belangrijk:** de edit aan `settleBet` is een additive parameter (default-naar-bestaand-gedrag). Bestaande callers in `confirmResult` en `autoResolveMatchBets` blijven werken zonder wijziging.

---

## Pre-flight verificatie

```bash
cd ~/zentrix

# 1. Branch + commit state
git status                                       # clean working tree
git log --oneline -1                             # 28f5ab1 (pollution fix op refactor-fase-5)
git tag -l | grep refactor-fase-5                # bestaat (P12 tag)

# 2. Tests baseline = 126
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  126 passed (126)"

# 3. src/lib/disputes/ leeg
ls src/lib/disputes 2>&1
# Verwacht: "No such file or directory"

# 4. Dispute + DisputeStatus + DisputeOutcome in schema
grep -cE "^(model Dispute|enum (DisputeStatus|DisputeOutcome))\b" prisma/schema.prisma
# Verwacht: 3

# 5. BetEvidence bestaat (hergebruiken voor dispute evidence)
grep -E "^model BetEvidence\b" prisma/schema.prisma
# Verwacht: 1 match

# 6. settleBet helper bestaat
grep -E "^export (async )?function settleBet" src/lib/bets/settlement.ts
# Verwacht: 1 match

# 7. FEES.DISPUTE_DEPOSIT_BPS + FEES.DISPUTE_RESOLUTION_BPS bestaan
grep -E "DISPUTE_(DEPOSIT|RESOLUTION)_BPS" src/lib/fees.ts | wc -l
# Verwacht: 2

# 8. ADMIN_USER_IDS env var nog niet bestaat
grep -E "ADMIN_USER_IDS" src/lib/env.ts
# Verwacht: leeg (we gaan toevoegen)

# 9. WSL heap-flag conventie
export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512"
```

Stop bij rood.

---

## Beslissingen

15 numbered decisions.

### 1. `DisputeError` class + 11-code union

```typescript
// src/lib/disputes/errors.ts
import "server-only";

export type DisputeErrorCode =
  | "DISPUTE_NOT_FOUND"               // 404
  | "DISPUTE_NOT_PARTICIPANT"         // 403 — opener moet bet creator of opponent zijn
  | "DISPUTE_INVALID_STATUS"          // 409 — open op SETTLED bet, resolve op al RESOLVED dispute, etc.
  | "DISPUTE_INVALID_INPUT"           // 400 — reason length, ontbrekende velden
  | "DISPUTE_INSUFFICIENT_BALANCE"    // 402 — fail-closed deposit lock (ADR §4)
  | "DISPUTE_ALREADY_OPEN"            // 409 — bet heeft al een non-RESOLVED dispute
  | "DISPUTE_OUTSIDE_WINDOW"          // 409 — match-attached dispute na disputeWindowEndsAt
  | "DISPUTE_EVIDENCE_LIMIT"          // 400 — max 10 evidence rows per (bet, uploader)
  | "DISPUTE_EVIDENCE_INVALID"        // 400 — bad contentHash format, missende fileUrl, etc.
  | "DISPUTE_NOT_ADMIN"               // 403 — caller niet in ADMIN_USER_IDS
  | "DISPUTE_VERSION_MISMATCH";       // 409 — status-as-version race guard

export class DisputeError extends Error {
  constructor(
    public code: DisputeErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "DisputeError";
  }
}
```

Geen aparte `DISPUTE_LEDGER_ERROR` code — als de ledger faalt, propageert `BET_SETTLEMENT_LEDGER_ERROR` of de onderliggende ledger-engine error. Caller-laag (HTTP routes in P16) mappt naar 5xx.

### 2. Admin gating — env-based allowlist

ADR-0003 §4 zegt "platform admin for MVP. No arbiter marketplace". `User.role` bestaat **niet** in het schema en toevoegen vereist een migration. Voor MVP: env-gestuurde allowlist via `ADMIN_USER_IDS` (comma-separated UUIDs).

```typescript
// src/lib/env.ts (edit, additive)
const Env = z.object({
  // ... bestaande velden ...
  ADMIN_API_TOKEN: z.string().min(32).optional(),
  ADMIN_USER_IDS: z.string().optional(), // comma-separated UUIDs of admin users
});
```

```typescript
// src/lib/disputes/admin.ts (NEW)
import "server-only";
import { env } from "@/lib/env";

export function isAdmin(userId: string): boolean {
  const raw = env().ADMIN_USER_IDS;
  if (!raw) return false;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.includes(userId);
}
```

Service-laag throws `DISPUTE_NOT_ADMIN` (403) als `isAdmin(callerId) === false`. Tests zetten `process.env.ADMIN_USER_IDS = adminUser.id` met `_resetEnvCache()` voor admin-pad coverage.

**Waarom geen `User.role` veld?** Migration ligt buiten P13 scope. ADR-0003 §4 specificeert alleen "admin decides" — operationaliseren via env is volledig consistent met die abstractielaag, en upgrade naar role-gebaseerd is forward-compat (env-allowlist blijft als kill-switch werken naast role-veld).

### 3. Dispute escrow — hergebruik `BET_ESCROW` AccountType

Schema's `AccountType` enum = `USER | BET_ESCROW | TREASURY | EXTERNAL`. **Geen** `DISPUTE_ESCROW`. Toevoegen vereist migration → buiten P13 scope.

**Pragmatische oplossing:** dispute deposit gaat naar een nieuwe `FinancialAccount` met `accountType = BET_ESCROW` en aparte `scopeKey`:

```
Bet escrow account: scopeKey = `bet:${betId}`         (huidig pattern uit P09 escrow.ts)
Dispute escrow:     scopeKey = `dispute:${disputeId}`
```

Voordeel: invariant cron uit P07 hoeft geen nieuwe accountType te kennen — dispute escrows tellen automatisch mee in de "BET_ESCROW totaalsom = ∑ open bet stakes + ∑ open dispute deposits" check.

```typescript
// src/lib/disputes/escrow.ts (NEW, mirror van src/lib/bets/escrow.ts)
import "server-only";
import type { TxClient } from "@/lib/ledger";

export async function getOrCreateDisputeEscrowAccount(
  tx: TxClient,
  disputeId: string,
) {
  const scopeKey = `dispute:${disputeId}`;
  const existing = await tx.financialAccount.findUnique({ where: { scopeKey } });
  if (existing) return existing;
  try {
    return await tx.financialAccount.create({
      data: {
        accountType: "BET_ESCROW",
        scopeKey,
        balanceUnits: 0n,
        label: `Dispute escrow for ${disputeId}`,
      },
    });
  } catch (err: unknown) {
    // P2002: another tx in race already created — re-fetch
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "P2002"
    ) {
      return await tx.financialAccount.findUniqueOrThrow({ where: { scopeKey } });
    }
    throw err;
  }
}
```

Open Q (§10 Q3): toekomstig migration kan `DISPUTE_ESCROW` als aparte accountType introduceren als invariant-isolation gewenst is. Voor MVP: hergebruik volstaat.

### 4. `lockDispute` helper (status-as-version race guard)

Mirror van `lockBet`/`lockMatch`/`lockPool`:

```typescript
// in src/lib/disputes/service.ts
export async function lockDispute(
  tx: TxClient,
  disputeId: string,
): Promise<{ id: string }> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM disputes WHERE id = ${disputeId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new DisputeError(
      "DISPUTE_NOT_FOUND",
      `Dispute ${disputeId} not found`,
      404,
    );
  }
  return rows[0]!;
}
```

`Dispute` heeft **geen** `version Int` veld. Race-guard: `tx.dispute.updateMany({where: {id, status: <expected>}})` met count-check (status-as-version pattern, zoals P12 `Match`).

### 5. `openDispute` — input + flow

```typescript
export interface OpenDisputeInput {
  betId: string;            // dispute is altijd op een bet (schema invariant)
  openerId: string;
  reason: string;           // 1-2000 chars
  idempotencyKey: string;   // HTTP-laag idempotency key
}

export interface OpenDisputeResult {
  dispute: Dispute;
  depositUnits: bigint;     // amount locked in dispute escrow
  ledgerTxId: string;       // for traceability
}
```

**Validatie:**
- `reason`: 1 ≤ length ≤ 2000 → anders `DISPUTE_INVALID_INPUT` (400).
- `bet` exists → anders `BET_NOT_FOUND` (404, via shared bet error voor consistentie met P10).
- `bet.status` ∈ `{ACTIVE, RESULT_PROPOSED, AWAITING_CONFIRMATION, DISPUTED}`. **Niet** SETTLED/CANCELLED/EXPIRED/VOID/DRAFT/OPEN → `DISPUTE_INVALID_STATUS` (409).
- `openerId` is `bet.createdById` of `bet.opponentUserId` → anders `DISPUTE_NOT_PARTICIPANT` (403).
- Geen bestaande open dispute op dezelfde bet (status ∈ `{OPEN, EVIDENCE_PHASE, ADMIN_REVIEW}`) → `DISPUTE_ALREADY_OPEN` (409).
- Match-attached pad: als `bet.matchId !== null`, lockt + valideert ook match.status `RESULT_SUBMITTED`. Als `match.disputeWindowEndsAt !== null && < now` → `DISPUTE_OUTSIDE_WINDOW` (409). Stand-alone bets (matchId null) hebben geen dispute window — die check skipt dan.

**Deposit calculation** (per ADR §3):
```typescript
import { applyBps, FEES } from "@/lib/fees";
const calculated = applyBps(bet.stakeUnits, FEES.DISPUTE_DEPOSIT_BPS); // 10%
const depositUnits = calculated < FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS
  ? FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS
  : calculated;
```

**Flow** (allemaal binnen één `prisma.$transaction`, timeout 15s):

1. **Idempotency check.** `tx.idempotencyKey.findUnique({where: {userId_key: {userId: openerId, key: idempotencyKey}}})`. Als bestaand met `responseJson` en niet expired → return cached. Bij `null` of expired → reserveer (insert met `responseJson: null`, `route: "dispute-open"`, `scope: "dispute"`, `expiresAt: now + IDEMPOTENCY_TTL_MS`).
2. **lockBet** + (optionele) **lockMatch** als bet.matchId.
3. **Guards** (zie boven). `DISPUTE_INSUFFICIENT_BALANCE` check eerst doen op opener's balance (read-only) voor early-exit — final check zit binnen `recordTransaction`.
4. **Insert Dispute** met status `OPEN`, depositLedgerTxId = null (vullen we in stap 6):
   ```typescript
   const dispute = await tx.dispute.create({
     data: {
       betId,
       openedById: openerId,
       reason,
       status: "OPEN",
     },
   });
   ```
5. **Lock opener financial account** + dispute escrow account aanmaken via `getOrCreateDisputeEscrowAccount(tx, dispute.id)`. Treasury account is hier **niet** betrokken (deposit lock is geen fee — geld blijft van de opener tot resolve).
6. **recordTransaction** met `idempotencyKey: \`dispute-deposit:${dispute.id}\``:
   ```
   DEBIT  user-account(opener)
   CREDIT dispute-escrow(disputeId)
   amount = depositUnits
   entryType = ESCROW_LOCK
   ```
   Bij `INSUFFICIENT_BALANCE` van ledger-engine → `throw new DisputeError("DISPUTE_INSUFFICIENT_BALANCE", ...)` → transaction rollt volledig terug. **Fail-closed:** dispute row + bet status update worden niet committed. ADR §4 punt 2 expliciet.
7. **Update Dispute** met `depositLedgerTxId = ledgerTx.id`.
8. **Update bet status** als nog niet DISPUTED:
   ```typescript
   const updated = await tx.bet.updateMany({
     where: { id: betId, version: bet.version, status: bet.status },
     data: { status: "DISPUTED", resultStatus: "DISPUTED", version: bet.version + 1 },
   });
   if (updated.count !== 1) throw new BetError("BET_VERSION_MISMATCH", ..., 409);
   ```
   Idempotent: als bet.status al DISPUTED is (omdat eerdere `confirmResult` met DISAGREE deze al zette), skipt deze update.
9. **Update match status** als bet.matchId:
   ```typescript
   await tx.match.updateMany({
     where: { id: bet.matchId, status: "RESULT_SUBMITTED" },
     data: { status: "DISPUTED" },
   });
   ```
   Geen count-check — andere bets op dezelfde match kunnen onafhankelijk nog SETTLED worden via aparte resolutiepaden.
10. **Insert BetStateTransition** als de bet-status nu net veranderde (alleen bij overgang RESULT_PROPOSED|AWAITING_CONFIRMATION|ACTIVE → DISPUTED):
    ```typescript
    await tx.betStateTransition.create({
      data: {
        betId,
        fromStatus: bet.status,
        toStatus: "DISPUTED",
        actorId: openerId,
        actorType: "USER",
        metadata: { disputeId: dispute.id, depositLedgerTxId: ledgerTx.id, depositUnits: depositUnits.toString() },
      },
    });
    ```
11. **Idempotency commit**: update reserved key met `responseJson = {disputeId, depositUnits}`, `statusCode = 201`, `completedAt = now`.

Returns: `{ dispute (refreshed), depositUnits, ledgerTxId }`.

### 6. `submitDisputeEvidence` — hergebruik `BetEvidence` tabel

Briefing veronderstelde een `DisputeEvidence` tabel. Schema heeft die niet — er zijn alleen `BetEvidence` en `MatchEvidence`. Aangezien een Dispute altijd op een Bet hangt, gebruiken we `BetEvidence` met een marker in metadata.

**Probleem:** `BetEvidence` heeft geen `disputeId` veld of metadata-kolom. Wel `description`. We gebruiken een conventie: dispute-fase evidence krijgt `description` prefix `[dispute:${disputeId}] `. Voor read-pad in `resolveDispute` queryen we `BetEvidence` waarvan description begint met de prefix.

**Pragmatisch oordeel:** dit is een convention-over-schema oplossing. Schoner ware een dedicated `DisputeEvidence` tabel met `disputeId`, `uploadedById`, `type`, `fileUrl`, `mimeType`, `contentHash`, `description`, plus `@@unique([disputeId, contentHash])` dedup. Voor MVP volstaat de prefix-conventie.

> **Tech debt — geregistreerd in `docs/TODO_KNOWN_ISSUES.md`:** "Migrate dispute evidence naar dedicated `DisputeEvidence` V2 table". Komt in PROMPT_18+ (post-MVP cleanup) zodra (a) de prefix-conventie operationeel pijn doet (filter-grep voor dispute-evidence count is N+1-pad bij grote bet-evidence sets), of (b) er een productfeature komt die dispute-evidence apart wil tonen van pre-dispute proof. Tot dan: prefix-pad blijft de canonical. Lees-paden in `resolveDispute` filteren via `description.startsWith("[dispute:${id}]")`.

```typescript
export interface SubmitDisputeEvidenceInput {
  disputeId: string;
  uploaderId: string;       // moet bet participant zijn
  items: Array<{
    type: "TEXT" | "URL" | "IMAGE" | "VIDEO";
    fileUrl?: string;       // required voor URL/IMAGE/VIDEO
    contentHash: string;    // sha256 hex 64 chars
    description?: string;   // user's eigen note (excl. de prefix)
  }>;
  idempotencyKey: string;
}

export interface SubmitDisputeEvidenceResult {
  dispute: Dispute;
  evidenceAdded: number;    // na dedup binnen call + tegen bestaande rijen
  evidenceTotal: number;    // totaal evidence rows nu op bet (alle uploaders, alle fasen)
}
```

**Validatie:**
- `dispute` exists → anders `DISPUTE_NOT_FOUND` (404).
- `dispute.status` ∈ `{OPEN, EVIDENCE_PHASE}` → anders `DISPUTE_INVALID_STATUS` (409). Eerste evidence-call promoveert `OPEN → EVIDENCE_PHASE` automatisch.
- `uploaderId` is bet participant → anders `DISPUTE_NOT_PARTICIPANT` (403).
- `items.length` ≥ 1 → anders `DISPUTE_INVALID_INPUT` (400).
- Per item: `contentHash` matcht `/^[a-f0-9]{64}$/i`, `type ∈ EvidenceType`, `fileUrl` aanwezig voor URL/IMAGE/VIDEO. Anders `DISPUTE_EVIDENCE_INVALID` (400).
- Cumulatieve limit: per uploader max 10 evidence rows op deze bet (alle fasen samen). `count(BetEvidence WHERE betId AND uploadedById)` + nieuwe items dedupped → > 10 ⇒ `DISPUTE_EVIDENCE_LIMIT` (400).

**Flow:**
1. Idempotency reserve (scope `"dispute-evidence"`).
2. `lockDispute` + `lockBet`.
3. Guards.
4. Dedup binnen `items[]`: Set op `contentHash`.
5. Dedup tegen bestaande `BetEvidence`: `findMany({where: {betId, contentHash: {in: hashes}}})`. Bestaande hashes uit input filteren. (Schema's `@@unique([betId, contentHash])` zou anders een P2002 throwen — proactief filter is netter.)
6. `createMany` voor de overgebleven items met `description = \`[dispute:${disputeId}] ${item.description ?? ""}\``.
7. Promotie: als `dispute.status === "OPEN"` → `updateMany({where:{id, status:"OPEN"}, data:{status:"EVIDENCE_PHASE"}})`. Count-check (status-as-version): bij 0 → `DISPUTE_VERSION_MISMATCH` (409).
8. Idempotency commit.

Returns: `{dispute, evidenceAdded, evidenceTotal}`.

### 7. `resolveDispute` — admin only, 3 outcomes

```typescript
export interface ResolveDisputeInput {
  disputeId: string;
  adminId: string;          // moet in ADMIN_USER_IDS env
  outcome: "CREATOR_WINS" | "OPPONENT_WINS" | "VOID";
  adminNotes?: string;      // optioneel, max 5000 chars
  idempotencyKey: string;
}

export interface ResolveDisputeResult {
  dispute: Dispute;
  bet: Bet;
  ledgerTxIds: string[];    // alle tx-ids die in deze resolve gegenereerd zijn (dispositie deposit + bet settlement/refund)
}
```

**Validatie:**
- `isAdmin(adminId)` → anders `DISPUTE_NOT_ADMIN` (403).
- `dispute` exists → `DISPUTE_NOT_FOUND` (404).
- `dispute.status` ∈ `{OPEN, EVIDENCE_PHASE, ADMIN_REVIEW}` → anders `DISPUTE_INVALID_STATUS` (409). Reeds RESOLVED → idempotent replay-pad via idempotency key (returns cached).
- `outcome` is geldige enum (TS dwingt af, maar runtime check voor HTTP-laag).
- `adminNotes` length 0..5000 → anders `DISPUTE_INVALID_INPUT` (400).

**Flow per outcome.** Alle drie binnen één `prisma.$transaction`, timeout 30s (settleBet kan ledger-zwaar zijn).

#### 7a. `CREATOR_WINS` — bet creator was correct

- **Wie wint dispute:** als de opener **createdById** is, opener wint → deposit refund. Als opener **opponentUserId** is, opener verliest → deposit forfeit (zie §9 voor forfeit destination).
- **Bet payout:** `settleBet({bet, winnerId: bet.createdById, fromStatus: "DISPUTED", actorId: adminId, feeOverrideBps: FEES.DISPUTE_RESOLUTION_BPS, ledgerIdempotencyKey: \`dispute-resolve:${disputeId}\`})`.
  - Pot = 2 × stake. Fee = 15% van pot (override van default 2%). Winner payout = pot − 0.15·pot.
  - `settleBet` (uitbreiding §8) handelt status-update naar SETTLED en `BetStateTransition` met actorType `"ADMIN_DISPUTE_RESOLVE"`.
- **Deposit dispositie:** zie §9 helper.

#### 7b. `OPPONENT_WINS` — bet opponent was correct

- Symmetrisch met 7a, met `winnerId: bet.opponentUserId`.

#### 7c. `VOID` — geen winnaar, beide stakes refund, geen fee

- `settleBet` is **niet** geschikt (geen winner, geen fee). Aparte refund-flow:
  - Lock beide user accounts + bet escrow + (deposit refund) opener account.
  - `recordTransaction` met `idempotencyKey: \`dispute-resolve-void:${disputeId}\``:
    ```
    DEBIT  bet-escrow(betId)  CREDIT user(creator)     amount = stake   entryType = BET_REFUND
    DEBIT  bet-escrow(betId)  CREDIT user(opponent)    amount = stake   entryType = BET_REFUND
    ```
  - Bet update: `status: "VOID", voidedAt: now, version+1`. Update via `updateMany` met version check.
  - `BetStateTransition` met `actorType: "ADMIN_DISPUTE_RESOLVE"`, metadata `{outcome: "VOID"}`.
- **Deposit dispositie:** ADR §4 noemt geen expliciete VOID rule. Default: **refund** naar opener (niet bestraft, want geen "loss"). Open Q5 in §10 voor alternatieve interpretatie.

#### Common tail — alle 3 outcomes

1. **Dispute update**:
   ```typescript
   const updated = await tx.dispute.updateMany({
     where: { id: disputeId, status: dispute.status },
     data: { status: "RESOLVED", outcome, resolvedById: adminId, resolvedAt: new Date(), adminNotes },
   });
   if (updated.count !== 1) throw new DisputeError("DISPUTE_VERSION_MISMATCH", ..., 409);
   ```
2. **Match status sync** als bet.matchId: leave-as-is bij CREATOR_WINS/OPPONENT_WINS (match blijft DISPUTED tot alle bets settled — andere bets op match wachten op hun eigen resolutie of disputeWindow expiry). Bij VOID: idem; match-level DISPUTED status wordt later (P15 cron) opgeruimd.
3. **Idempotency commit** scope `"dispute-resolve"`.

Returns `{dispute (refreshed), bet (refreshed), ledgerTxIds}`.

### 8. `settleBet` extension — `feeOverrideBps?: number`

```typescript
// src/lib/bets/settlement.ts (edit)
export interface SettleBetInput {
  bet: Bet;
  winnerId: string;
  ledgerIdempotencyKey: string;
  fromStatus: "RESULT_PROPOSED" | "DISPUTED" | "ACTIVE";
  actorId: string | null;
  feeOverrideBps?: number;  // NEW — defaults to FEES.PLATFORM_BPS
  actorType?: string;       // NEW — defaults to existing logic; allows "ADMIN_DISPUTE_RESOLVE"
}
```

```typescript
const feeBps = input.feeOverrideBps ?? FEES.PLATFORM_BPS;
const feeUnits = applyBps(potUnits, feeBps);
const winnerPayout = potUnits - feeUnits;
// ... rest unchanged
```

`actorType` resolution:
```typescript
let actorType: string;
if (input.actorType) {
  actorType = input.actorType;
} else if (fromStatus === "ACTIVE" && actorId !== null) {
  actorType = "POOL_CREATOR_RESOLVE";
} else if (actorId === null) {
  actorType = "SYSTEM";
} else {
  actorType = "USER";
}
```

Backward-compat: bestaande callers (`confirmResult`, `autoResolveMatchBets`) geven geen `feeOverrideBps`/`actorType` → default-pad → identieke output. Alleen `resolveDispute` zet ze.

ADR-0003 §3 fee-tabel cited: "Dispute resolution fee | 15% of pot | Replaces 2% when a dispute is resolved (does **not** stack)". Deze override is daar het mechanisme voor.

### 9. Deposit forfeit destination — naar treasury

ADR-0003 §4 punt 1+2 zegt: "Only the dispute opener stores 10%. ... If the deposit-lock ledger transaction fails, the dispute does not open." En §4 punt 3 over reputation: "the bettor's deposit is forfeited."

**Niet** geëxpliciteerd: bij forfeit gaat het deposit naar wie? Wager (referentie) gaf forfeit aan defender. ADR-0003 zegt impliciet via §3 fee-tabel niets over deposit-bestemming.

**Beslissing voor MVP:** forfeited deposit → **treasury** (TREASURY account). Reasoning:
- Defender heeft al de bet-pot gewonnen via `settleBet` (15% fee al ingehouden); extra deposit-bonus voor defender stapelt incentives op een manier die niet in ADR staat.
- Treasury-pad is operationeel het simpelste (één bestaand account, geen nieuwe invariants).
- Forward-compat met `UserReputation` (P14): als reputation systeem later wil dat deposit naar defender gaat, is dat een extra ledger-line in dezelfde tx, geen herstructurering.

Helper:
```typescript
async function disposeDeposit(
  tx: TxClient,
  dispute: Dispute,
  bet: Bet,
  opener: { id: string },
  outcome: DisputeOutcome,
  ledgerIdempotencyKey: string,
): Promise<{ ledgerTxId: string; destination: "OPENER" | "TREASURY" }> {
  const opener_won_dispute =
    (outcome === "CREATOR_WINS" && opener.id === bet.createdById) ||
    (outcome === "OPPONENT_WINS" && opener.id === bet.opponentUserId) ||
    outcome === "VOID";

  const escrow = await getOrCreateDisputeEscrowAccount(tx, dispute.id);
  const balance = escrow.balanceUnits;
  if (balance === 0n) {
    return { ledgerTxId: "", destination: opener_won_dispute ? "OPENER" : "TREASURY" };
  }

  const destAcct = opener_won_dispute
    ? await getUserAccount(tx, opener.id)
    : await getTreasuryAccount(tx);

  const result = await recordTransaction({
    tx,
    idempotencyKey: ledgerIdempotencyKey,
    description: `Dispute deposit dispositie (dispute=${dispute.id}, outcome=${outcome})`,
    initiatorUserId: null,
    refType: "dispute",
    refId: dispute.id,
    lines: [
      {
        debitAccountId: escrow.id,
        creditAccountId: destAcct.id,
        amountUnits: balance,
        entryType: opener_won_dispute ? "ESCROW_RELEASE" : "FEE_COLLECTION",
        note: opener_won_dispute
          ? `dispute-deposit-refund:${dispute.id}`
          : `dispute-deposit-forfeit:${dispute.id}`,
      },
    ],
  });

  return { ledgerTxId: result.transaction.id, destination: opener_won_dispute ? "OPENER" : "TREASURY" };
}
```

Wordt aangeroepen door `resolveDispute` na de `settleBet`/refund-stap, met `ledgerIdempotencyKey: \`dispute-deposit-dispose:${disputeId}\``.

### 10. `forceCancelBet` — admin emergency override (geen dispute)

Aparte service voor de edge case waar een bet vastzit (bv. opponent ghosted, beide partijen hebben geen winner geclaimed, dispute window verlopen, geen reguliere CANCEL-pad meer beschikbaar).

```typescript
export interface ForceCancelBetInput {
  betId: string;
  adminId: string;
  reason: string;           // 1-2000 chars, gaat naar BetStateTransition.metadata
  idempotencyKey: string;
}

export interface ForceCancelBetResult {
  bet: Bet;
  ledgerTxId: string | null;  // null als bet was DRAFT/OPEN (geen escrow lock om te releasen)
}
```

**Validatie:**
- `isAdmin(adminId)` → anders `DISPUTE_NOT_ADMIN` (403).
- `bet` exists → `BET_NOT_FOUND`.
- `bet.status` ∈ `{DRAFT, OPEN, ACTIVE, RESULT_PROPOSED, AWAITING_CONFIRMATION, DISPUTED}`. Niet SETTLED/CANCELLED/EXPIRED/VOID → `BET_INVALID_STATUS` (409).
- `reason` length 1..2000 → `BET_INVALID_INPUT` (400).

**Flow:**
1. Idempotency reserve (scope `"force-cancel-bet"`).
2. `lockBet`.
3. **Refund pad** afhankelijk van pre-cancel status:
   - **DRAFT/OPEN**: alleen creator stake in escrow (P09 createBet locked stake). Refund naar creator.
   - **ACTIVE/RESULT_PROPOSED/AWAITING_CONFIRMATION/DISPUTED**: beide stakes in escrow. Refund 50/50 naar creator + opponent.
   - In alle gevallen: één `recordTransaction` met `idempotencyKey: \`force-cancel:${betId}\``, lines per refund-route.
4. **Open dispute handling**: als bet heeft een non-RESOLVED dispute, óók die dispute resolven met `outcome: "VOID"` + deposit refund naar opener (zelfs als opener eigenlijk niet "won" — VOID is beide-onschuldig pad). Dit voorkomt dangling disputes.
5. Bet update: `status: "CANCELLED", cancelledAt: now, version+1`. `updateMany` count-check.
6. `BetStateTransition` met `actorType: "ADMIN_FORCE"`, metadata `{reason, refundedToCreator, refundedToOpponent, disputeVoided?}`.
7. Idempotency commit.

Returns `{bet, ledgerTxId}`.

**Geen dispute deposit mechanism** in deze service zelf — het is admin override, niet user-flow. Maar als bet had een open dispute, die wordt automatisch VOID gezet (per stap 4) zodat ledger-state consistent blijft.

### 11. Idempotency keys — drie scopes

HTTP-laag (`IdempotencyKey` tabel, scope-veld):
- `"dispute"` — gebruikt door openDispute (route `"dispute-open"`). User-supplied key.
- `"dispute-evidence"` — submitDisputeEvidence.
- `"dispute-resolve"` — resolveDispute. Admin-supplied key (per dispute resolution).
- `"force-cancel-bet"` — forceCancelBet. Admin-supplied.

Ledger-laag (`LedgerTransaction.idempotencyKey`, deterministisch):
- `dispute-deposit:${disputeId}` — initial deposit lock in openDispute.
- `dispute-resolve:${disputeId}` — bet payout via settleBet (CREATOR_WINS/OPPONENT_WINS).
- `dispute-resolve-void:${disputeId}` — bet refund 50/50 (VOID).
- `dispute-deposit-dispose:${disputeId}` — deposit refund/forfeit dispositie (na main resolve).
- `force-cancel:${betId}` — refund van force-cancel.

Replay-paden (HTTP retry binnen 24h TTL): cached `responseJson` returned, geen re-execute. Replay buiten TTL: nieuwe attempt; ledger-laag idempotency vangt op (dezelfde deterministic keys, `recordTransaction` returns existing zonder dubbele entries).

### 12. Match-dispute handling — één Dispute per bet

Schema's `Dispute.betId NOT NULL` betekent: een "match dispute" is fysiek een dispute op één specifieke bet binnen die match. Andere bets op dezelfde match worden **niet** automatisch gedisputeerd.

**Concreet gedrag:**
- Bettor A op Match M opent dispute op bet `bet_A` → `bet_A.status: DISPUTED`, `M.status: DISPUTED`.
- Bettor B op Match M (op andere bet `bet_B`) is niet betrokken; `bet_B` blijft ACTIVE/etc.
- Resolve van `dispute_A` (CREATOR_WINS/OPPONENT_WINS) settled alleen `bet_A`. Andere bets op M wachten op:
  - Hun eigen dispute (als bettor opent), of
  - `autoResolveMatchBets({skipDisputeWindow: true})` triggered door admin (P12 helper) zodra alle disputes op M zijn afgerond.

P15 cron (later) handles transitie `M.status: DISPUTED → SETTLED` zodra geen open disputes meer op M en remaining ACTIVE bets door admin worden afgehandeld. P13 zelf laat `M.status` op DISPUTED staan — geen automatische match-status-rollback.

Open Q6 in §10: alternatief gedrag waarbij een match-dispute alle bets op die match in DISPUTED zet. Vereist schema `Dispute.matchId?` migration.

### 13. Status-as-version race guard pattern

Mirrors P12 Match. Op elke status-mutatie:

```typescript
const result = await tx.dispute.updateMany({
  where: { id: disputeId, status: expectedStatus },
  data: { status: newStatus, ...other },
});
if (result.count !== 1) {
  throw new DisputeError(
    "DISPUTE_VERSION_MISMATCH",
    `Dispute ${disputeId} concurrently mutated`,
    409,
  );
}
```

Geen separate `version Int` veld nodig op `Dispute` (alle reguliere transities zijn monotone forward, geen "edits-in-place").

### 14. Test structuur — ~18 tests

#### 14a. `dispute-lifecycle.test.ts` — 8 tests

**openDispute (4):**
1. **Happy path** — Stand-alone bet ACTIVE, opener=opponent, balance ≥ deposit. Verwacht: dispute row OPEN, bet status DISPUTED, escrow balance = depositUnits, opener balance −= depositUnits, BetStateTransition row, idempotency row completed.
2. **Insufficient balance fail-closed** — opener balance < deposit. Verwacht: throws `DISPUTE_INSUFFICIENT_BALANCE`, geen Dispute row, bet status onveranderd (still ACTIVE), opener balance onveranderd.
3. **Non-participant** — random user probeert opens. Verwacht: `DISPUTE_NOT_PARTICIPANT`, geen state change.
4. **Already-open dispute** — eerste openDispute slaagt; tweede call (zelfs door andere participant) → `DISPUTE_ALREADY_OPEN`. Bet/balance state na tweede call identiek aan na eerste.

**submitDisputeEvidence (4):**
5. **Happy path 3 items** — opener voegt 3 evidence items toe, dispute promoveert OPEN → EVIDENCE_PHASE, BetEvidence rows met `[dispute:${id}]`-prefix in description.
6. **Defender voegt evidence toe** — bet creator (niet de opener) voegt 2 items toe na opener's openDispute. Verwacht: groen, beide uploaderId's in BetEvidence.
7. **Limit 11e item** — opener heeft al 10 evidence rows op deze bet (legacy + dispute). 11e items[].length===1 call → `DISPUTE_EVIDENCE_LIMIT`. Bestaande 10 ongewijzigd.
8. **Dedup binnen call + tegen bestaande** — 5-item call met 2 dup hashes (in items[]) en 1 hash die al in DB staat. Verwacht: 2 nieuwe rows (5 − 2 dup-binnen − 1 dup-DB), `evidenceAdded === 2`.

#### 14b. `dispute-resolve.test.ts` — 10 tests

**resolveDispute outcomes (6):** Elke outcome-test moet de **fee-replacement invariant** uit ADR §3 expliciet asserten — bij CREATOR_WINS/OPPONENT_WINS is treasury-credit van deze settlement **exact `applyBps(pot, 1500)`**, niet `applyBps(pot, 200) + applyBps(pot, 1500)`. Concreet: na resolve `treasury.balanceUnits − pre_treasury` moet === 15% van pot. Geen 17%, geen dubbele fee-line in `LedgerEntry`.

9. **CREATOR_WINS, opener=opponent (loser)** — bet creator wins, **dispute fee = exact 15% pot** naar treasury (assert `treasuryDelta === applyBps(stake*2n, 1500)`, **niet** `applyBps(stake*2n, 1700)`), deposit forfeit naar treasury, opener net loss = stake + deposit. Tevens: ledger-entries voor deze settlement count = 2 (payout + fee), niet 3 (geen aparte 2% line).
10. **CREATOR_WINS, opener=creator (winner)** — opener wint dispute, deposit refund naar opener, creator wins bet (stake + payout), **15% fee naar treasury** (zelfde fee-replacement assertion).
11. **OPPONENT_WINS, opener=opponent** — opener wint, deposit refund, opponent wins bet, **15% fee** (zelfde assertion).
12. **OPPONENT_WINS, opener=creator (loser)** — opener verliest dispute, deposit forfeit treasury, opponent wins, **15% fee**.
13. **VOID** — beide stakes refunded 50/50 (assert beide users +stake), deposit refund naar opener, **treasury delta === 0** (geen fee bij VOID), bet status VOID, dispute outcome VOID.
14. **Idempotent replay** — resolveDispute met zelfde idempotencyKey 2x → tweede call returns cached responseJson, geen dubbele ledger-tx (assert `LedgerTransaction count` constant tussen call 1 en call 2).

**forceCancelBet (3):**
15. **Happy path ACTIVE bet** — admin force-cancels, beide stakes refunded 50/50, bet CANCELLED.
16. **With open dispute** — bet heeft open dispute (status EVIDENCE_PHASE). Force-cancel → bet CANCELLED + dispute auto-VOID + deposit refund naar opener. Eén consistente ledger state.
17. **Already SETTLED bet** — admin probeert force-cancel op SETTLED bet → `BET_INVALID_STATUS`.

**Admin gating (1):**
18. **Non-admin probeert resolve** — `resolveDispute({adminId: nonAdminUserId, ...})` → `DISPUTE_NOT_ADMIN`. Verwacht: dispute state onveranderd.

### 15. Test infrastructure

```typescript
const SUFFIX = `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PRIVY_PREFIX = `wd-${SUFFIX}-`;

async function cleanupAll() {
  await prisma.disputeEvidence?.deleteMany?.(); // niet bestaand — placeholder
  await prisma.dispute.deleteMany();
  await prisma.betStateTransition.deleteMany();
  await prisma.betEvidence.deleteMany();
  await prisma.betParticipantConfirmation.deleteMany();
  await prisma.betResultClaim.deleteMany();
  await prisma.betParticipant.deleteMany();
  await prisma.betInvite.deleteMany();
  await prisma.bet.deleteMany();
  await prisma.matchEvidence.deleteMany();
  await prisma.match.deleteMany();
  await prisma.pool.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.ledgerTransaction.deleteMany();
  await prisma.financialAccount.deleteMany({
    where: { OR: [{ accountType: "USER" }, { scopeKey: { startsWith: "bet:" } }, { scopeKey: { startsWith: "dispute:" } }] },
  });
  await prisma.user.deleteMany({ where: { privyId: { startsWith: PRIVY_PREFIX } } });
  await prisma.financialAccount.updateMany({
    where: { scopeKey: { in: ["treasury", "external"] } },
    data: { balanceUnits: 0n },
  });
}

async function setupAdmin(): Promise<{ admin: User; restore: () => void }> {
  const admin = await prisma.user.create({
    data: { privyId: `${PRIVY_PREFIX}admin`, email: `admin-${SUFFIX}@test.local` },
  });
  const previous = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = admin.id;
  _resetEnvCache();
  return {
    admin,
    restore: () => {
      if (previous === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = previous;
      _resetEnvCache();
    },
  };
}

async function userWithBalance(units: bigint, label = "user"): Promise<User> {
  const user = await prisma.user.create({
    data: { privyId: `${PRIVY_PREFIX}${label}-${Date.now()}-${Math.random()}` },
  });
  await prisma.financialAccount.create({
    data: { accountType: "USER", scopeKey: `user:${user.id}`, userId: user.id, balanceUnits: units },
  });
  return user;
}

async function createAcceptedBet(creator: User, opponent: User, stake: bigint): Promise<Bet> {
  // Reuse P09 createBet + P09 acceptBet helpers
  // Returns bet with status ACTIVE, both stakes locked
  // Implementation borrows from existing P10/P12 test helpers
}

async function createDisputedBet(creator: User, opponent: User, stake: bigint, opener: User, depositPayer: User): Promise<{bet: Bet, dispute: Dispute}> {
  const bet = await createAcceptedBet(creator, opponent, stake);
  const result = await openDispute({
    betId: bet.id,
    openerId: opener.id,
    reason: "test dispute",
    idempotencyKey: `test-${SUFFIX}-${bet.id}`,
  });
  return { bet: await prisma.bet.findUniqueOrThrow({where:{id:bet.id}}), dispute: result.dispute };
}
```

Cleanup-order strict: child rows first (FK violations anders). `dispute:` scopeKey financial accounts expliciet meegenomen in deleteMany filter.

---

## BEGIN PROMPT — uitvoering

**Workflow:** review-then-execute (per `feedback_zentrix_rules.md`). Gebruiker ziet deze spec, geeft ofwel "go" met eventuele aanpassingen, ofwel inhoudelijke feedback voor revisie. Géén code-wijzigingen tot expliciet groen licht.

### Step 0 — pre-flight

Run alle 9 verificaties uit "Pre-flight verificatie" sectie. Stop bij rood. Doel: working tree clean, baseline 126 tests groen, schema bevat Dispute models, geen conflicting `src/lib/disputes/` directory.

### Step 1 — `disputes/errors.ts`

Schrijf `src/lib/disputes/errors.ts` met `DisputeError` class + 11-code union per §1. Run `pnpm typecheck` — moet 0 zijn (file is standalone).

### Step 2 — `disputes/escrow.ts`

Schrijf `src/lib/disputes/escrow.ts` met `getOrCreateDisputeEscrowAccount` per §3. Mirror van `src/lib/bets/escrow.ts`. Typecheck.

### Step 3 — `env.ts` edit + `disputes/admin.ts`

Edit `src/lib/env.ts` om `ADMIN_USER_IDS: z.string().optional()` toe te voegen aan het zod schema. Schrijf `src/lib/disputes/admin.ts` met `isAdmin` helper. Typecheck.

### Step 4 — `disputes/service.ts` (lockDispute + openDispute + submitDisputeEvidence)

Schrijf de eerste helft van `src/lib/disputes/service.ts`:
- `lockDispute` (§4)
- `openDispute` (§5)
- `submitDisputeEvidence` (§6)

Typecheck na elke functie. Geen tests nog.

### Step 5 — `bets/settlement.ts` edit (feeOverrideBps + actorType)

Edit `src/lib/bets/settlement.ts` per §8. Backward-compat verifiëren: bestaande `confirmResult` en `autoResolveMatchBets` moeten zonder wijziging blijven werken. Typecheck.

### Step 6 — `disputes/service.ts` (resolveDispute + forceCancelBet)

Schrijf de tweede helft:
- `disposeDeposit` private helper (§9)
- `resolveDispute` met outcome-switch (§7)
- `forceCancelBet` (§10)

Typecheck.

### Step 7 — `dispute-lifecycle.test.ts`

Schrijf alle 8 tests uit §14a. Run:
```bash
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" \
  ./node_modules/.bin/vitest run src/__tests__/disputes/dispute-lifecycle.test.ts
```
Doel: 8/8 in isolatie. Bij rood: fix root cause, niet tests aanpassen om groen te krijgen.

### Step 8 — `dispute-resolve.test.ts`

Schrijf alle 10 tests uit §14b. Run in isolatie. Doel: 10/10.

### Step 9 — full suite

```bash
NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512" pnpm test
```
Doel: **144 passed** (126 baseline + 18 nieuw). Bij regressie elders: fix forward (geen tests skippen). Verwachte runtime ~10-12 minuten gegeven P09-P12 patroon.

### Step 10 — STOP en wacht op user akkoord

Geen commit. Rapporteer:
- Aantal tests groen (verwacht 144)
- Test count delta vs briefing-schatting (~148): documenteer waarom 144 niet 148 (3 outcomes ipv 6).
- Eventuele afwijkingen van de spec tijdens uitvoering (decisions die anders moesten lopen).
- Working tree state (`git status`).

**Geen** push, **geen** commit, **geen** tag. Gebruiker reviewt + geeft expliciet "commit + push" prompt.

---

## Post-flight checks

1. **Geen hardcoded fee/deposit numbers** — alle BPS via `FEES.PLATFORM_BPS`, `FEES.DISPUTE_RESOLUTION_BPS`, `FEES.DISPUTE_DEPOSIT_BPS`, `FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS` uit `src/lib/fees.ts`. Grep:
   ```bash
   grep -E "(0\.10|10%|1500|200|1000)" src/lib/disputes/ | grep -v "FEES\." | grep -v "test" 
   # Verwacht: leeg
   ```
2. **Alle services in `prisma.$transaction`** — geen DB-mutaties buiten tx scope.
3. **`settleBet` hergebruikt** voor CREATOR_WINS + OPPONENT_WINS (met `feeOverrideBps`).
4. **`autoResolveMatchBets` niet aangeroepen** door P13 — match-cleanup is P15 cron scope.
5. **Test count 126 → 144** (+18). Geen tests overgeslagen, geen `.skip` of `.todo`.
6. **`server-only` import** boven elk file in `src/lib/disputes/`.
7. **Idempotency-pattern consistent** met P10/P11/P12 (zelfde `IdempotencyKey` tabel-shape, zelfde TTL constant).
8. **Geen schema-mutaties** — `prisma migrate status` toont geen pending/draft migrations.
9. **Geen deletions van bestaande code** — alleen additive edits aan `bets/settlement.ts` en `env.ts`.
10. **Working tree na step 9**: alleen nieuwe files in `src/lib/disputes/` + `src/__tests__/disputes/` + 2 edits (`bets/settlement.ts`, `env.ts`).

---

## Wat dit NIET doet

| Onderwerp | Komt in |
|---|---|
| `UserReputation` snapshots na resolve (win/lose/score updates) | PROMPT_14 |
| `dispute-abuse-prevention` (rate limit, escalated 20% deposit voor recidivisten) | PROMPT_14 |
| Cron voor expired-window auto-cleanup van OPEN disputes (>72h zonder evidence) | PROMPT_15 |
| Cron voor match-status DISPUTED → SETTLED rollup na alle bets resolved | PROMPT_15 |
| Invariant cron: ∑ dispute-escrow balances = ∑ open dispute deposits | PROMPT_15 |
| HTTP routes `POST /api/disputes`, `/disputes/:id/evidence`, `/disputes/:id/resolve`, `/admin/bets/:id/force-cancel` | PROMPT_16 |
| Admin UI voor dispute review + resolve | PROMPT_17+ |
| Schema: `User.role`, `DisputeEvidence`, `Dispute.matchId`, extra DisputeOutcome enum-waardes | Aparte migration-prompt na ADR-0004 (indien gewenst, zie open Qs) |

---

## Resolved questions (locked 2026-05-10)

Originele open Qs zijn beslist door user. Antwoorden zijn **bindend** voor uitvoering.

| # | Vraag | Beslissing | Verwerkt in §|
|---|---|---|---|
| Q1 | DisputeOutcome enum: 3 vs 6 | **3 outcomes** (`CREATOR_WINS \| OPPONENT_WINS \| VOID`). SPLIT/ABUSE/INVALID buiten scope MVP. | §1, §7 |
| Q2 | DisputeStatus init | **`OPEN`** als default, `OPEN → EVIDENCE_PHASE → ADMIN_REVIEW → RESOLVED` transitiepad | §5, §6, §13 |
| Q3 | Dispute escrow accountType | **Hergebruik `BET_ESCROW`** met scopeKey `dispute:{id}` (geen migration) | §3 |
| Q4 | Dispute evidence model | **`BetEvidence` met description-prefix** voor MVP. Tech debt geregistreerd in `docs/TODO_KNOWN_ISSUES.md` voor latere V2 migratie naar dedicated `DisputeEvidence` tabel. | §6 |
| Q5 | VOID deposit dispositie | **Refund naar opener** (geen straf bij neutrale uitkomst) | §7c, §9 |
| Q6 | Match-dispute scope | **1 dispute per bet**; `match.status: DISPUTED` volgt automatisch maar andere bets op die match blijven onafhankelijk | §5, §12 |
| Q7 | Admin gating | **env `ADMIN_USER_IDS`** allowlist (comma-separated UUIDs); geen `User.role` migration | §2 |
| Q8 | Forfeit destination | **Treasury** (simpler dan Wager defender-split; defender krijgt al pot via 15% fee model) | §9 |
| Q9 | Test count target | **+18 tests** (126 → 144) | §14 |
| Q10 | `forceCancelBet` error class | **Mengmodel**: `BetError` voor bet-state codes, `DisputeError` voor admin-gating | §1, §10 |

**Plus 3 surfaced punten (alle akkoord):**

| # | Punt | Beslissing | Verwerkt in §|
|---|---|---|---|
| S1 | Geen `DisputeStateTransition` tabel | Akkoord; status-as-version pattern volstaat | §13 |
| S2 | Geen `Dispute.version` veld | Akkoord; defensive `WHERE id AND status=expected` count-check (mirror Match P12) | §4, §13 |
| S3 | `settleBet` `feeOverrideBps` extension | Akkoord en **kritisch**: tests asserten dat 15% dispute fee de 2% platform fee **vervangt** (niet stapelt) per ADR-0003 §3. Concrete assertion in §14b tests #9-12: `treasuryDelta === applyBps(pot, 1500)`, **niet** `applyBps(pot, 1700)`. | §8, §14b |

Geen verdere open Qs vóór uitvoering. Spec is execution-ready.

---

## Length

Spec ~960 regels (na resolutie van open Qs in tabelvorm; oorspronkelijke target 1100-1400 was inclusief de 10-Q uitwerking).

---

## Volgende stap

Spec is approved. Start step 0 pre-flight zodra user "go P13 step 0" zegt. Geen uitvoering tot expliciet groen licht.
