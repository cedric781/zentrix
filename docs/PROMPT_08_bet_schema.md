# PROMPT_08 — Bet schema (1v1 P2P fundament + Pool container)

**Refactor fase 1 deliverable.** Eerste schema-stap na fase 0 cleanup, conform [ADR-0003](./ADR-0003-1v1-with-tournament-pools.md) en [REFACTOR_PLAN.md](./REFACTOR_PLAN.md).

---

## Doel

Schema additions die het 1v1 P2P fundament + Pool-as-tournament-container introduceren. Geen services, geen routes, geen UI — alleen:

- 13 modellen (Bet + side-tabellen, Pool + Match + MatchEvidence, Dispute, IdempotencyKey extension, UserReputation)
- 10 enums
- 1 Postgres trigger (`bets_creator_cannot_bet_on_own_pool_match`)
- 1 module file: `src/lib/fees.ts` (single-source-of-truth voor fee BPS)
- Smoke tests die de schema-invariants verifiëren (DRAFT default, BetParticipant uniqueness, trigger-werking, IdempotencyKey backward-compat)

Test count target na P08: 47 → ~55 (4 fees.ts unit tests + 4 schema smoke tests).

---

## Builds on

- **PROMPT_07** — `LedgerTransaction`, `LedgerEntry`, `FinancialAccount` (P07 ledger), `IdempotencyKey { key @id, scope, createdAt }`, `CircuitBreaker`. Allemaal onaangetast door P08 — uitsluitend additief.
- **Refactor fase 0** (commit `ceb826c`, tag `refactor-fase-0`) — verwijderde Pool/PoolEntry/DisputeLog/SettlementJob + 4 enums + parimutuel trigger. Schema staat schoon op P01-P07 modellen plus drop-migration.
- **ADR-0003** — alle 8 sub-secties: Bet model, Pool feature, Fees, Dispute, Idempotency, Race conditions, Security, "do not copy from Wager".
- **REFACTOR_PLAN.md** — sectie 4 (artefacten + bron) + sectie 10 beslissingen 1-6 (IdempotencyKey uitbreiden, geen DisputeComment, MatchEvidence aparte tabel, exact trigger SQL, memory file naamgeving, DROP-migration strategie).
- **Wager-pattern reference** in `~/.claude/projects/-home-rapha-zentrix/memory/feedback_wager_patterns.md` — what to copy / what NOT to copy lijst.

---

## Files touched

| File | Mutatie | Omvang |
|---|---|---|
| `prisma/schema.prisma` | Voeg 13 modellen + 10 enums toe; breid `User` + `IdempotencyKey` uit met back-relations / nullable kolommen | ~350 regels toegevoegd |
| `prisma/migrations/<ts>_add_bet_schema_v1/migration.sql` | Auto-generated CREATE TABLEs + handmatig toegevoegde trigger SQL aan einde | ~250 regels gegenereerd + ~30 hand-edits |
| `src/lib/fees.ts` | Nieuw: `FEES` constant + `applyBps()` helper + types | ~50 regels |
| `src/__tests__/money/fees.test.ts` | Nieuw: 4 unit tests voor fee math | ~80 regels |
| `src/__tests__/smoke/bet-schema.test.ts` | Nieuw: 4 smoke tests (DRAFT default, BetParticipant unique, trigger blokkeert, IdempotencyKey backward-compat) | ~150 regels |

---

## Pre-flight verificatie

```bash
cd ~/zentrix

# 1. Branch + commit state
git status                                       # clean working tree
git log --oneline -3                             # ceb826c (refactor-fase-0)

# 2. Tag aanwezig
git tag -l | grep refactor-fase-0                # → "refactor-fase-0"

# 3. Tests baseline = 47
NODE_OPTIONS="--max-old-space-size=8192" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  47 passed (47)"

# 4. Schema bevat geen parimutuel residue
grep -E "^model (Pool|PoolEntry|DisputeLog|SettlementJob)\b" prisma/schema.prisma
# Verwacht: 0 matches

# 5. WSL heap-flag is verplicht voor typecheck (zie feedback_wsl_tsc_heap memory)
export NODE_OPTIONS="--max-old-space-size=8192"
```

Als één van de boven faalt: stop, root cause vinden, niet doorgaan.

---

## Beslissingen

23 numbered decisions die de spec verankeren. Elk besluit volgt het format: **wat** (concrete shape) + **waarom** (rationale, ADR-bron, of Wager-pattern).

### 1. Schema scope: 13 modellen + 10 enums + 1 trigger + 1 module

**Modellen:**
1. `Bet` — 1v1 wager primitief
2. `BetParticipant` — exact 2 rows per Bet (creator + opponent), uniek per side
3. `BetInvite` — token-hash invite link (creator → opponent)
4. `BetEvidence` — proof bundle voor 1v1 disputes
5. `BetStateTransition` — audit van elke status-mutatie
6. `BetParticipantConfirmation` — actie-log per participant (CONFIRM_WINNER / DISAGREE)
7. `BetResultClaim` — V3-only result claim (één per user per bet)
8. `Match` — Pool-internal grouping unit
9. `MatchEvidence` — proof bundle per Match (door pool creator)
10. `Pool` — vereenvoudigde tournament-container (geen aggregates)
11. `Dispute` — admin-decided outcome, opener-only deposit
12. `IdempotencyKey` — uitgebreid (bestaande velden behouden, nieuwe optioneel)
13. `UserReputation` — abuse-prevention snapshot

**Enums (10):**
1. `BetStatus` (10 waardes)
2. `SettlementMode` (alleen `PROOF_CONFIRM` voor MVP)
3. `ResultStatus` (5 waardes)
4. `MatchStatus` (4 waardes)
5. `PoolStatus` (5 waardes incl. CANCELLED — nieuw, kleiner dan oude parimutuel-versie)
6. `DisputeStatus` (4 waardes)
7. `DisputeOutcome` (3 waardes)
8. `ReputationTier` (3 waardes)
9. `EvidenceType` (4 waardes — gedeeld door BetEvidence + MatchEvidence)
10. `ConfirmationDecision` (2 waardes)

**Trigger:** `bets_creator_cannot_bet_on_own_pool_match` (raw SQL in migration).

**Module:** `src/lib/fees.ts` — alle fee BPS values centraal.

**Waarom 13 modellen / 10 enums:** ADR-0003 §1-3 lijst exact deze artefacten. Wager-pattern memory lijst Cs 1, 5, 6, 7, 8, 9, 10, 12, 13 als 1-op-1 over te nemen. ADR-0003 + REFACTOR_PLAN beslissing 3 voegen `MatchEvidence` toe als consistent pattern naast `BetEvidence`.

---

### 2. `Bet` model — ~25 fields

```prisma
model Bet {
  id                    String          @id @default(uuid())
  createdById           String          @map("created_by_id")
  opponentUserId        String?         @map("opponent_user_id")
  creatorSide           String          @map("creator_side")
  acceptorSide          String?         @map("acceptor_side")
  stakeUnits            BigInt          @map("stake_units")

  status                BetStatus       @default(DRAFT)
  settlementMode        SettlementMode  @default(PROOF_CONFIRM) @map("settlement_mode")
  resultStatus          ResultStatus    @default(PENDING) @map("result_status")
  winnerId              String?         @map("winner_id")

  version               Int             @default(0)
  expiresAt             DateTime        @map("expires_at")
  confirmDeadline       DateTime?       @map("confirm_deadline")
  disputeWindowEndsAt   DateTime?       @map("dispute_window_ends_at")

  settledAt             DateTime?       @map("settled_at")
  cancelledAt           DateTime?       @map("cancelled_at")
  voidedAt              DateTime?       @map("voided_at")

  poolId                String?         @map("pool_id")
  matchId               String?         @map("match_id")

  createdByLedgerTxId   String?         @map("created_by_ledger_tx_id")

  createdAt             DateTime        @default(now()) @map("created_at")
  updatedAt             DateTime        @updatedAt @map("updated_at")

  createdBy             User            @relation("BetCreator", fields: [createdById], references: [id])
  opponent              User?           @relation("BetOpponent", fields: [opponentUserId], references: [id])
  winner                User?           @relation("BetWinner", fields: [winnerId], references: [id])
  pool                  Pool?           @relation(fields: [poolId], references: [id])
  match                 Match?          @relation(fields: [matchId], references: [id])

  participants          BetParticipant[]
  invite                BetInvite?
  evidence              BetEvidence[]
  stateTransitions      BetStateTransition[]
  confirmations         BetParticipantConfirmation[]
  resultClaims          BetResultClaim[]
  disputes              Dispute[]

  @@index([status], map: "idx_bets_status")
  @@index([createdById, createdAt], map: "idx_bets_creator_created")
  @@index([opponentUserId, createdAt], map: "idx_bets_opponent_created")
  @@index([poolId, status], map: "idx_bets_pool_status")
  @@index([matchId, status], map: "idx_bets_match_status")
  @@index([expiresAt], map: "idx_bets_expires_at")
  @@map("bets")
}
```

**Veld-rationale:**
- `expiresAt` is verplicht. Voor `DRAFT` is het een 30-dagen cleanup-deadline; voor `OPEN` de 24h accept-deadline. Service-laag herinterpreteert per status (Wager-pattern uit `wager-deadlines.ts`).
- `version` start op 0, wordt geïncrementeerd bij elke status-mutatie via `updateMany({where: {id, version}})` — Wager pattern §6 race conditions.
- `createdByLedgerTxId` audit-link naar de bet-hold ledger transactie. Nullable omdat de Bet eerst als DRAFT wordt gecreëerd zonder ledger lock; de FK wordt na `holdBetStake` ingevuld bij promotie naar OPEN.
- `acceptorSide` is nullable — gevuld bij accept. `opponentUserId` idem.
- `winnerId` nullable, gevuld bij settle/dispute-resolve.
- `poolId` + `matchId` allebei nullable. Toegestane combinaties:
  - `(NULL, NULL)` — stand-alone bet, geen Pool of Match.
  - `(poolId, NULL)` — Pool-level bet zonder Match-binding (zeldzaam, maar mogelijk).
  - `(poolId, matchId)` — Pool-attached + Match-attached, normale tournament case.
  
  De combinatie `(NULL, matchId)` is *niet toegestaan*: een Match hoort altijd bij een Pool, dus een Match-attached Bet moet ook bij die Pool horen. Dit wordt afgedwongen via een **DB CHECK constraint** `bet_match_requires_pool` (zie #22 voor exacte SQL) — defense-in-depth bovenop de service-layer guard in `createBet`.

**Waarom geen oracle/sport/manual_review velden:** ADR-0003 §"What we explicitly do not copy from Wager" expliciet uitgesloten. Post-MVP additie vereist nieuwe ADR.

**Indexes:** vijf composite indexes zoals Wager. `idx_bets_match_status` is nieuw — gebruikt door `submitMatchResult` om alle Bets per Match op te halen.

---

### 3. `BetStatus` enum — exact 10 waardes

```prisma
enum BetStatus {
  DRAFT                  // creator funded, niet zichtbaar
  OPEN                   // accept-deadline lopend
  ACTIVE                 // beide sides funded, wachten op resultaat
  RESULT_PROPOSED        // één participant heeft winnaar geclaimd
  AWAITING_CONFIRMATION  // tegenpartij moet bevestigen
  DISPUTED               // dispute open, escrow vast
  SETTLED                // payout uitgevoerd, terminal
  CANCELLED              // creator cancelt vóór accept, terminal
  EXPIRED                // accept- of confirm-deadline gemist, terminal
  VOID                   // dispute → void, terminal
}
```

**Waarom 10 (geen 24 zoals Wager):** ADR-0003 §1. Wager's overige status-waardes (`LIVE`, `AWAITING_RESULT`, `ARBITER_REVIEW`, `RESULT_DETECTED`, `RESOLVED`, `MANUAL_REVIEW`, `VERIFICATION_*`, `PROVIDER_DISAGREEMENT`, `EXPIRED_CLEANED`, `FUNDING_PENDING`, `PROOF_SUBMITTED`, `CONFIRMED`) zijn voor andere settlement modes (AUTO_VERIFY, ARBITER_REQUIRED) of legacy. Die modes komen niet voor in MVP.

**Hard rule:** uitbreiden vereist nieuwe ADR.

---

### 4. `SettlementMode` enum — alleen `PROOF_CONFIRM` voor MVP

```prisma
enum SettlementMode {
  PROOF_CONFIRM
  // ARBITER_REQUIRED, AUTO_VERIFY post-MVP — separate ADR
}
```

**Waarom niet meteen meerdere:** ADR-0003 §1. Wager bouwde 5 modes en heeft een `settlement-mode-resolver` over-engineered geworden. Eén mode per ADR-iteratie houdt scope strak.

**Bet.settlementMode default:** `PROOF_CONFIRM`. Bij toekomstige toevoeging van `ARBITER_REQUIRED` zal het default ongewijzigd blijven; bestaande Bets blijven PROOF_CONFIRM.

---

### 5. `ResultStatus` enum — 5 waardes

```prisma
enum ResultStatus {
  PENDING       // geen claim ingediend
  PROPOSED      // eerste participant heeft winnaar geclaimd
  CONFIRMED     // beide participants bevestigden zelfde winnaar
  DISPUTED      // confirm-conflict of dispute geopend
  OVERRIDDEN    // admin-beslissing overrules participants
}
```

**Waarom 5:** dekt PROOF_CONFIRM volledig + dispute-uitkomst + admin-override. `VERIFIED` (Wager auto-verify) is weggelaten — voor MVP niet relevant.

---

### 6. `BetParticipant` met `@@unique([betId, side])`

```prisma
model BetParticipant {
  id            String   @id @default(uuid())
  betId         String   @map("bet_id")
  userId        String   @map("user_id")
  side          String   // "A" of "B" — string, geen enum (creator/acceptor labels variëren)
  hasConfirmed  Boolean  @default(false) @map("has_confirmed")
  confirmedAt   DateTime? @map("confirmed_at")
  createdAt     DateTime @default(now()) @map("created_at")

  bet           Bet      @relation(fields: [betId], references: [id], onDelete: Cascade)
  user          User     @relation(fields: [userId], references: [id])

  @@unique([betId, side], map: "uq_bet_participants_bet_side")
  @@unique([betId, userId], map: "uq_bet_participants_bet_user")
  @@index([userId, createdAt], map: "idx_bet_participants_user_created")
  @@map("bet_participants")
}
```

**Twee unique constraints:**
- `[betId, side]`: maximaal twee BetParticipant rows per Bet (één per side).
- `[betId, userId]`: één user kan niet beide sides innemen.

**Waarom `side String` en geen `BetSide` enum:** Wager doet hetzelfde — `creatorSide`/`acceptorSide` op Bet zijn ook strings. Frontend mapt naar UI-labels. Een 2-waarde enum (`A`/`B`) zou juist abstraheren waar geen abstractie nodig is.

**onDelete: Cascade** op `betId` — als ooit een Bet hard-deleted wordt (bv. tijdens dev-resets), participants gaan automatisch mee. In productie wordt nooit gedelete.

---

### 7. `BetInvite` met token-hash

```prisma
model BetInvite {
  id          String   @id @default(uuid())
  betId       String   @unique @map("bet_id")
  tokenHash   String   @unique @map("token_hash")
  createdAt   DateTime @default(now()) @map("created_at")
  expiresAt   DateTime @map("expires_at")
  usedAt      DateTime? @map("used_at")
  usedById    String?  @map("used_by_id")

  bet         Bet      @relation(fields: [betId], references: [id], onDelete: Cascade)
  usedBy      User?    @relation(fields: [usedById], references: [id])

  @@index([expiresAt], map: "idx_bet_invites_expires")
  @@map("bet_invites")
}
```

**Waarom alleen `tokenHash`:** plain token leeft alleen in de aanmaak-response van `createBet` en in de invite-URL. Server stort uitsluitend de sha256-hash. Vergelijkingen via `safeHashCompare` (constant-time) — Wager security pattern §"Constant-time hash compare voor invite tokens".

**`@unique` op `betId`:** één invite per Bet. Regenerate (Wager pattern) doet `delete + create`, niet upsert — zorgt voor schone audit-trail in BetStateTransition.

---

### 8. `BetEvidence` (1v1 dispute evidence)

```prisma
model BetEvidence {
  id            String       @id @default(uuid())
  betId         String       @map("bet_id")
  uploadedById  String       @map("uploaded_by_id")
  type          EvidenceType
  fileUrl       String?      @map("file_url")
  mimeType      String?      @map("mime_type")
  contentHash   String       @map("content_hash")
  description   String?
  createdAt     DateTime     @default(now()) @map("created_at")

  bet           Bet          @relation(fields: [betId], references: [id], onDelete: Cascade)
  uploadedBy    User         @relation(fields: [uploadedById], references: [id])

  @@unique([betId, contentHash], map: "uq_bet_evidence_bet_hash")
  @@index([uploadedById, createdAt], map: "idx_bet_evidence_user_created")
  @@map("bet_evidence")
}

enum EvidenceType {
  TEXT
  URL
  IMAGE
  VIDEO
}
```

**Waarom `@@unique([betId, contentHash])`:** Wager security pattern §"Evidence dedup via sha256 contentHash". Voorkomt dat dezelfde foto/screenshot 10× geüpload wordt om een dispute-thread vol te spammen.

**Waarom `fileUrl` + `mimeType` nullable:** TEXT-type evidence heeft geen file. URL-type heeft fileUrl maar geen mimeType (browse). De CHECK is service-layer (TEXT → fileUrl moet null zijn, IMAGE/VIDEO → fileUrl + mimeType moeten gezet zijn).

**Same enum als MatchEvidence (#14):** consistente naamgeving + één bron voor type-validatie.

---

### 9. `BetStateTransition` (audit)

```prisma
model BetStateTransition {
  id            String     @id @default(uuid())
  betId         String     @map("bet_id")
  fromStatus    BetStatus  @map("from_status")
  toStatus      BetStatus  @map("to_status")
  actorId       String?    @map("actor_id")
  actorType     String     @map("actor_type")  // "USER" | "SYSTEM" | "ADMIN"
  metadata      Json?      // welke velden gewijzigd, dispute id, ledger tx, etc.
  createdAt     DateTime   @default(now()) @map("created_at")

  bet           Bet        @relation(fields: [betId], references: [id], onDelete: Cascade)
  actor         User?      @relation(fields: [actorId], references: [id])

  @@index([betId, createdAt], map: "idx_bet_state_transitions_bet_created")
  @@index([actorId, createdAt], map: "idx_bet_state_transitions_actor_created")
  @@map("bet_state_transitions")
}
```

**Waarom een aparte tabel naast `LedgerTransaction`:** ledger spoort *geld*-bewegingen, BetStateTransition spoort *status*-bewegingen. Niet elke status-transitie heeft geld-flow (DRAFT → CANCELLED met refund is wel ledger; OPEN → EXPIRED is alleen status zonder ledger). Eén-op-één coupling zou twee zorgen door elkaar halen.

**`actorType` als string i.p.v. enum:** Wager-pattern. Drie waardes maar uitbreidbaar (e.g., `ARBITER` post-MVP) zonder migration.

**`metadata Json?`:** vrije payload voor `{ledgerTxId, fieldsChanged, disputeId, ...}`. Niet queried in hot path, alleen voor admin-debug.

---

### 10. `BetParticipantConfirmation` (V3 only)

```prisma
model BetParticipantConfirmation {
  id                  String                @id @default(uuid())
  betId               String                @map("bet_id")
  userId              String                @map("user_id")
  decision            ConfirmationDecision
  claimedWinnerId     String?               @map("claimed_winner_id")
  createdAt           DateTime              @default(now()) @map("created_at")

  bet                 Bet                   @relation(fields: [betId], references: [id], onDelete: Cascade)
  user                User                  @relation("ConfirmationActor", fields: [userId], references: [id])
  claimedWinner       User?                 @relation("ConfirmationClaimedWinner", fields: [claimedWinnerId], references: [id])

  @@index([betId, createdAt], map: "idx_bet_confirmations_bet_created")
  @@index([userId, createdAt], map: "idx_bet_confirmations_user_created")
  @@map("bet_participant_confirmations")
}

enum ConfirmationDecision {
  CONFIRM_WINNER  // ik bevestig X als winnaar
  DISAGREE        // ik ben het oneens met de huidige claim
}
```

**Waarom 2 waardes (geen 5 zoals Wager):** simpler. `CONFIRM_WINNER + claimedWinnerId` dekt zowel "ik claim mezelf" als "ik claim tegenpartij". `DISAGREE` is enkel "ik ben oneens" — bij DISAGREE wordt geen `claimedWinnerId` gezet, dispute-flow start.

**Waarom V3 only:** geen V1 `ResultClaim` table erbij — we vermijden de Wager dual-version chaos.

---

### 11. `BetResultClaim` (V3 only — geen V1)

```prisma
model BetResultClaim {
  id                  String   @id @default(uuid())
  betId               String   @map("bet_id")
  claimedById         String   @map("claimed_by_id")
  claimedWinnerId     String?  @map("claimed_winner_id")
  note                String?
  createdAt           DateTime @default(now()) @map("created_at")

  bet                 Bet      @relation(fields: [betId], references: [id], onDelete: Cascade)
  claimedBy           User     @relation("ResultClaimActor", fields: [claimedById], references: [id])
  claimedWinner       User?    @relation("ResultClaimWinner", fields: [claimedWinnerId], references: [id])

  @@unique([betId, claimedById], map: "uq_bet_result_claims_bet_user")
  @@index([betId, createdAt], map: "idx_bet_result_claims_bet_created")
  @@map("bet_result_claims")
}
```

**Verschil met `BetParticipantConfirmation`:**
- `BetResultClaim` = de eerste claim (start van settlement). Eén per user per Bet (`@@unique`).
- `BetParticipantConfirmation` = vervolg-acties (confirm of disagree op een al-bestaande claim). Geen unique — een user kan meerdere keren confirm/disagree als status terug gaat naar PROPOSED (theoretisch, niet productionellijk).

**Open question:** dit gaat strikt genomen overlappen — een claim is óók een soort van confirmation. Wager heeft beide tabellen omdat de V1→V3 migratie ze beide liet leven. Voor MVP behouden we beide; consolidatie kan later (zie open Q4).

---

### 12. `Match` model

```prisma
model Match {
  id                    String       @id @default(uuid())
  poolId                String       @map("pool_id")
  title                 String
  description           String?
  eventTime             DateTime?    @map("event_time")
  status                MatchStatus  @default(SCHEDULED)
  winnerSide            String?      @map("winner_side")  // "A" | "B" | NULL
  submittedAt           DateTime?    @map("submitted_at")
  disputeWindowEndsAt   DateTime?    @map("dispute_window_ends_at")
  settledAt             DateTime?    @map("settled_at")
  createdAt             DateTime     @default(now()) @map("created_at")
  updatedAt             DateTime     @updatedAt @map("updated_at")

  pool                  Pool         @relation(fields: [poolId], references: [id], onDelete: Cascade)
  bets                  Bet[]
  evidence              MatchEvidence[]

  @@index([poolId, status], map: "idx_matches_pool_status")
  @@index([eventTime], map: "idx_matches_event_time")
  @@map("matches")
}
```

**`winnerSide` als string:** consistent met Bet's `creatorSide`/`acceptorSide`/BetParticipant.side. Service-laag mapt `"A"` op de winnerId van elke Bet's BetParticipant met side="A".

**`onDelete: Cascade`:** als een Pool gedeleted wordt (alleen tijdens dev-reset), Matches gaan mee. Productie deletet nooit.

**`eventTime` nullable:** sommige matches hebben geen vaste tijd (e.g., "match wordt binnen 7 dagen gespeeld"). Service-layer hint die te zetten is goed UX.

---

### 13. `MatchStatus` enum

```prisma
enum MatchStatus {
  SCHEDULED         // Match aangemaakt, geen result nog
  RESULT_SUBMITTED  // Pool creator heeft winnerSide gezet, dispute window loopt
  SETTLED           // Dispute window verstreken zonder dispute, alle Bets settled
  DISPUTED          // Minstens 1 bettor heeft dispute geopend
}
```

**4 waardes:** elke logische fase. Geen `CANCELLED` — een Match wordt nooit gecancelled, óf hij wordt SETTLED met VOID-uitkomst (dispute → void) óf hij blijft SCHEDULED tot Pool gesloten wordt (dan blijft hij hangen — see Pool status flow).

---

### 14. `MatchEvidence` (per ADR-0003 §2 + REFACTOR_PLAN beslissing 3)

```prisma
model MatchEvidence {
  id            String       @id @default(uuid())
  matchId       String       @map("match_id")
  uploadedById  String       @map("uploaded_by_id")
  type          EvidenceType
  fileUrl       String?      @map("file_url")
  mimeType      String?      @map("mime_type")
  contentHash   String       @map("content_hash")
  description   String?
  createdAt     DateTime     @default(now()) @map("created_at")

  match         Match        @relation(fields: [matchId], references: [id], onDelete: Cascade)
  uploadedBy    User         @relation(fields: [uploadedById], references: [id])

  @@unique([matchId, contentHash], map: "uq_match_evidence_match_hash")
  @@index([uploadedById, createdAt], map: "idx_match_evidence_user_created")
  @@map("match_evidence")
}
```

**Volledig parallel aan `BetEvidence`:** zelfde shape, zelfde enum (`EvidenceType`), zelfde dedup-strategie. Pool creator kan meerdere evidence rows toevoegen wanneer hij `winnerSide` submit (TEXT + URL + IMAGE + VIDEO door elkaar).

**Service-layer guard:** `uploadedById` moet gelijk zijn aan `Match.pool.createdById` (alleen pool creator kan match-evidence uploaden). DB CHECK constraint hiervoor is over-engineerd — service-laag handelt het.

---

### 15. `Pool` model — vereenvoudigd

```prisma
model Pool {
  id                String      @id @default(uuid())
  createdById       String      @map("created_by_id")
  title             String
  description       String?
  status            PoolStatus  @default(DRAFT)
  bettingClosesAt   DateTime    @map("betting_closes_at")
  createdAt         DateTime    @default(now()) @map("created_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")

  createdBy         User        @relation("PoolCreator", fields: [createdById], references: [id])
  matches           Match[]
  bets              Bet[]

  @@index([status], map: "idx_pools_status")
  @@index([createdById, createdAt], map: "idx_pools_creator_created")
  @@map("pools")
}
```

**Wat is weggelaten t.o.v. de oude (parimutuel) Pool:**
- `totalSideAUnits`, `totalSideBUnits`, `totalPotUnits` — geen aggregates meer.
- `sideALabel`, `sideBLabel` — labels leven per Bet (`creatorSide`, `acceptorSide`).
- `creatorFeeBps` — geen per-pool fee override. Uniform via `fees.ts`.
- `winningSide`, `declaredAt` — Pool resolveert geen sides; Match doet dat per stuk.
- `settlementDelayHours` — dispute window is per Match (24h hard-coded), niet per Pool.

**Direct gevolg:** `createPool` service is bijna triviaal — title, description, bettingClosesAt + creator. De Pool-aggregate-locking complexity die in oud P09 zat, vervalt.

---

### 16. `PoolStatus` enum — 5 waardes

```prisma
enum PoolStatus {
  DRAFT      // creator bouwt pool, geen matches/bets nog
  OPEN       // matches gepubliceerd, bettingClosesAt nog niet verstreken
  CLOSED     // bettingClosesAt verstreken, alle matches in submit/dispute fase
  SETTLED    // alle matches SETTLED, terminal
  CANCELLED  // creator heeft DRAFT pool gecancelled, terminal
}
```

**Transitions:**
- `DRAFT → OPEN` — pool creator publiceert (gerealiseerd in P11 `publishPool`).
- `DRAFT → CANCELLED` — pool creator heft DRAFT pool op (gerealiseerd in P11 `cancelPool`). **Alleen vanaf DRAFT.**
- `OPEN → CLOSED` — `bettingClosesAt` verstreken (cron-driven of inline-check in P12).
- `CLOSED → SETTLED` — alle Matches in deze Pool hebben status SETTLED (P12 trigger).

**Hard rule:** OPEN of CLOSED pools kunnen *niet* gecancelled worden — er staan al Bets in escrow. Refund-flow op match-niveau (DISPUTED → VOID) handelt individuele Bet-refunds; geen pool-level refund-pad.

**Wat is weggelaten:**
- `REFUNDED` — geen pool-level refund. Refunds gebeuren per Match via DISPUTED → VOID-uitkomst, niet bulk per Pool.

---

### 17. `Dispute` model (admin-decided, opener-only deposit)

```prisma
model Dispute {
  id                  String          @id @default(uuid())
  betId               String          @map("bet_id")
  openedById          String          @map("opened_by_id")
  reason              String
  depositLedgerTxId   String?         @map("deposit_ledger_tx_id")
  status              DisputeStatus   @default(OPEN)
  outcome             DisputeOutcome?
  resolvedById        String?         @map("resolved_by_id")
  resolvedAt          DateTime?       @map("resolved_at")
  adminNotes          String?         @map("admin_notes")
  createdAt           DateTime        @default(now()) @map("created_at")
  updatedAt           DateTime        @updatedAt @map("updated_at")

  bet                 Bet             @relation(fields: [betId], references: [id], onDelete: Cascade)
  openedBy            User            @relation("DisputeOpener", fields: [openedById], references: [id])
  resolvedBy          User?           @relation("DisputeResolver", fields: [resolvedById], references: [id])

  @@index([betId, status], map: "idx_disputes_bet_status")
  @@index([openedById, createdAt], map: "idx_disputes_opener_created")
  @@index([status, createdAt], map: "idx_disputes_status_created")
  @@map("disputes")
}
```

**`depositLedgerTxId`** — FK naar de `LedgerTransaction.id` waar de 10% deposit gelocked werd (idempotency-key: `dispute-deposit:{betId}:{userId}`). Nullable omdat fail-closed dispute-open eerst de deposit lockt; pas bij succes wordt Dispute row écht gecreëerd. Maar voor audit-laag is de FK gewenst.

**Geen `version` veld:** alle status transitions gaan via `updateMany({where: {id, status: <prev>}})` — als status al verschoven is, count==0, throw. Alternatief voor optimistic version, simpler.

**Admin-decided:** `resolvedById` is altijd een admin user. Service-layer (P13) controleert `User.role === "ADMIN"` (rol-veld komt in P13 of zit elders, te verifiëren).

---

### 18. `DisputeStatus` + `DisputeOutcome` enums

```prisma
enum DisputeStatus {
  OPEN              // dispute net geopend, deposit gelocked
  EVIDENCE_PHASE    // beide partijen kunnen evidence uploaden
  ADMIN_REVIEW      // admin reviewt evidence + neemt beslissing
  RESOLVED          // outcome ingevuld, terminal
}

enum DisputeOutcome {
  CREATOR_WINS
  OPPONENT_WINS
  VOID
}
```

**Waarom 4 dispute states:** elke fase heeft duidelijke transition triggers. `OPEN→EVIDENCE_PHASE` automatisch via cron als beide partijen evidence kunnen uploaden, `EVIDENCE_PHASE→ADMIN_REVIEW` via deadline of explicit admin claim, `ADMIN_REVIEW→RESOLVED` via admin decision.

**Outcome semantiek:**
- `CREATOR_WINS` → `Bet.winnerId = createdById`, settle met dispute-fee (15%) i.p.v. platform-fee (2%). Opener-deposit forfeit naar winner als opener verloor; refund als opener won.
- `OPPONENT_WINS` → idem voor opponentUserId.
- `VOID` → both refund, dispute-fee (15%) blijft van pot afgetrokken (deposit refund naar opener — Wager BUSINESS_RULES.md regel 64-65).

---

### 19. `IdempotencyKey` UITBREIDEN (per beslissing 1)

```prisma
model IdempotencyKey {
  // BESTAAND (ongewijzigd voor P05/P06 backward compat):
  key             String    @id
  scope           String
  createdAt       DateTime  @default(now()) @map("created_at")

  // NIEUW (allemaal nullable — bet-routes vullen ze, deposit/withdrawal-routes niet):
  userId          String?   @map("user_id")
  route           String?
  statusCode      Int?      @map("status_code")
  responseJson    Json?     @map("response_json")
  completedAt     DateTime? @map("completed_at")
  expiresAt       DateTime? @map("expires_at")

  user            User?     @relation(fields: [userId], references: [id])

  // BESTAAND:
  @@index([scope, createdAt], map: "idx_idem_scope_created")

  // NIEUW:
  @@unique([userId, key], map: "uq_idem_user_key")
  @@index([expiresAt], map: "idx_idem_expires")
  @@index([userId, route, createdAt], map: "idx_idem_user_route_created")

  @@map("idempotency_keys")
}
```

**Migration impact:**
- 6 nieuwe kolommen, allemaal nullable → geen data-backfill nodig.
- 1 nieuwe `@@unique([userId, key])` — kan gevoelig zijn als bestaande rows duplicate `(userId=NULL, key=X)` hebben. Postgres beschouwt NULL als distinct, dus meerdere rijen met `(NULL, samekey)` zijn toegestaan. Zou geen probleem moeten zijn voor P05/P06 die `userId` niet zetten.
- 2 nieuwe indexes.

**Hoe Bet-routes het gebruiken:**
```typescript
// in src/lib/bets/idempotency.ts (komt P09)
await prisma.idempotencyKey.create({
  data: {
    key: clientHeader,
    scope: `bet:${userId}:create`,   // of "bet:accept", "bet:cancel", etc.
    userId,
    route: req.url,
    statusCode: 0,                    // 0 = pending
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  },
});
```

P05/P06 routes blijven ongewijzigd:
```typescript
// Blijven dit doen (geen userId, geen route, etc.):
await prisma.idempotencyKey.create({
  data: { key: depositTxHash, scope: "deposit" },
});
```

**Geen breaking change.**

---

### 20. `UserReputation` model

```prisma
model UserReputation {
  id              String          @id @default(uuid())
  userId          String          @unique @map("user_id")
  score           Int             @default(100)   // range 0-100
  disputesOpened  Int             @default(0) @map("disputes_opened")
  disputesWon     Int             @default(0) @map("disputes_won")
  disputesLost    Int             @default(0) @map("disputes_lost")
  tier            ReputationTier  @default(NORMAL)
  lastUpdatedAt   DateTime        @default(now()) @map("last_updated_at")

  user            User            @relation(fields: [userId], references: [id])

  @@index([tier], map: "idx_user_reputation_tier")
  @@index([score], map: "idx_user_reputation_score")
  @@map("user_reputations")
}
```

**Schema only in P08.** Geen update-logica, geen cron, geen abuse-prevention helpers. Die komen in P14.

**`score` start op 100:** elke nieuwe user is "NORMAL" tot anders bewezen. Score-deductie via P14 logic.

**`@unique` op `userId`:** één UserReputation row per user. Lazy-create bij eerste dispute-open.

---

### 21. `ReputationTier` enum

```prisma
enum ReputationTier {
  NORMAL       // score >= 50, geen restricties
  RESTRICTED   // score < 50 of disputeRate > 60%, geen nieuwe disputes
  FLAGGED      // admin-flag, manual review op elke transactie
}
```

**3 tiers:** Wager-pattern simplified. Wager heeft 4 (NORMAL, ELEVATED, RESTRICTED, FROZEN) — voor MVP genoeg met 3.

---

### 22. Trigger: `bets_creator_cannot_bet_on_own_pool_match`

**Hand-toegevoegd aan migration.sql na `prisma migrate dev --create-only`:**

```sql
-- bets_creator_cannot_bet_on_own_pool_match
-- Hard guard: een Pool creator kan niet bettor zijn op een Bet die in zijn eigen Pool valt.
-- Multi-bet per (user, pool) is wel toegestaan zolang user niet de Pool's creator is.
-- ADR-0003 + REFACTOR_PLAN beslissing 4.

CREATE OR REPLACE FUNCTION bets_creator_cannot_bet_on_own_pool_match()
RETURNS TRIGGER AS $$
DECLARE
  pool_creator_id text;
BEGIN
  IF NEW.pool_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT created_by_id INTO pool_creator_id FROM pools WHERE id = NEW.pool_id;

  IF pool_creator_id IS NULL THEN
    -- Pool bestaat niet (FK zou dit normaal blokkeren, maar belt-and-braces).
    RAISE EXCEPTION 'Bet refers to non-existent pool (pool_id=%)', NEW.pool_id;
  END IF;

  IF pool_creator_id = NEW.created_by_id OR pool_creator_id = NEW.opponent_user_id THEN
    RAISE EXCEPTION 'Pool creator cannot bet on own pool (pool_id=%, creator=%)',
      NEW.pool_id, pool_creator_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bets_creator_cannot_bet_on_own_pool_match
  BEFORE INSERT OR UPDATE ON bets
  FOR EACH ROW EXECUTE FUNCTION bets_creator_cannot_bet_on_own_pool_match();

-- Match-Pool consistency: een Bet met matchId moet ook bij een Pool horen.
-- Defense-in-depth bovenop de service-layer guard in createBet (zie #2).
ALTER TABLE bets ADD CONSTRAINT bet_match_requires_pool
  CHECK (match_id IS NULL OR pool_id IS NOT NULL);
```

**Waarom BEFORE INSERT OR UPDATE:**
- INSERT: vangt creation-time inserts (Bet aangemaakt door creator).
- UPDATE: vangt latere mutaties die `pool_id` of `opponent_user_id` wijzigen (bv. `acceptBet` zet `opponent_user_id`).

**Geen `WHEN` clause:** trigger draait altijd, fast-path bij `pool_id IS NULL` (eerste IF in function body).

**Plaatsing in migration.sql:** als laatste statement, ná alle CREATE TABLEs, zodat de `pools` table bestaat als de trigger-function ernaar refereert.

---

### 23. `src/lib/fees.ts` module

```typescript
// src/lib/fees.ts
//
// CANONICAL: single source of truth voor alle fee BPS values.
// Geen hard-coded percentages elders in de codebase — altijd via dit module.
// Reference: ADR-0003 §3 (Fees uniform, single-source-of-truth).

import "server-only";

export const FEES = {
  /** 2% bij settlement, alleen op winner side. Bij dispute-resolved vervangen door DISPUTE_RESOLUTION_BPS. */
  PLATFORM_BPS: 200,

  /** 15% bij dispute-resolved — vervangt PLATFORM_BPS, stack niet. */
  DISPUTE_RESOLUTION_BPS: 1500,

  /** 10% van stake, opener-only deposit bij dispute open. */
  DISPUTE_DEPOSIT_BPS: 1000,

  /** Minimum dispute deposit ($0.50 in USDC units, BigInt). */
  DISPUTE_DEPOSIT_MIN_USDC_UNITS: 500_000n,

  /** 1% bij off-ramp withdrawal. */
  WITHDRAWAL_BPS: 100,

  /** Minimum withdrawal fee ($0.10). */
  WITHDRAWAL_MIN_USDC_UNITS: 100_000n,

  /** Maximum withdrawal fee ($5.00). */
  WITHDRAWAL_MAX_USDC_UNITS: 5_000_000n,
} as const;

export type FeeKey = keyof typeof FEES;

/**
 * Apply BPS rate to a unit amount, floored.
 * Pure BigInt math, geen floating point.
 *
 * @param units — bedrag in USDC units (1 USDC = 1_000_000 units)
 * @param bps   — basis points (1 bps = 0.01%, dus 200 = 2%)
 * @returns     — units * bps / 10000, floored
 */
export function applyBps(units: bigint, bps: number): bigint {
  if (units < 0n) {
    throw new RangeError("applyBps: units must be non-negative");
  }
  if (bps < 0 || bps > 10_000) {
    throw new RangeError("applyBps: bps must be 0..10000");
  }
  return (units * BigInt(bps)) / 10000n;
}

/**
 * Compute dispute deposit met minimum-floor.
 * Wager BUSINESS_RULES.md regel 20: 10% van stake, min $0.50.
 */
export function calcDisputeDeposit(stakeUnits: bigint): bigint {
  const raw = applyBps(stakeUnits, FEES.DISPUTE_DEPOSIT_BPS);
  return raw < FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS
    ? FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS
    : raw;
}

/**
 * Compute withdrawal fee met min/max clamp.
 */
export function calcWithdrawalFee(amountUnits: bigint): bigint {
  const raw = applyBps(amountUnits, FEES.WITHDRAWAL_BPS);
  if (raw < FEES.WITHDRAWAL_MIN_USDC_UNITS) return FEES.WITHDRAWAL_MIN_USDC_UNITS;
  if (raw > FEES.WITHDRAWAL_MAX_USDC_UNITS) return FEES.WITHDRAWAL_MAX_USDC_UNITS;
  return raw;
}
```

**Tests komen in `src/__tests__/money/fees.test.ts` (zie Step 2).**

---

## ── BEGIN PROMPT — uitvoering ──

You are extending zentrix met het Bet schema voor refactor fase 1. **De single most important rule:** alle 13 modellen + 10 enums + trigger + fees.ts module landen in één commit, samen met smoke tests die de invariants verifiëren. Geen partial commit. Geen services in deze prompt — die komen in PROMPT_09.

**Hard constraints:**
- `src/lib/fees.ts` is de enige plek waar fee BPS-numbers leven. `grep -nE "200|1500|1000" src/lib/` mag alleen matches geven binnen `fees.ts` (en eventueel in BetEvidence enum-namen, niet in code).
- Trigger SQL gaat in de migration.sql, NIET in schema.prisma (Prisma genereert geen triggers).
- Alle nieuwe modellen krijgen `@@map("snake_case_table")` voor consistente DB-naming.
- IdempotencyKey extension is **additief** — bestaande P05/P06 inserts blijven werken.
- Smoke tests gebruiken het prefix-cleanup pattern (`SUFFIX + PRIVY_PREFIX` zoals oud `pool-lifecycle.test.ts`) voor afterAll-cleanup.

---

### Step 0 — Pre-flight

```bash
cd ~/zentrix
git status                                       # clean
git log --oneline -3                             # ceb826c (refactor-fase-0)
git tag -l | grep refactor-fase-0                # bestaat
export NODE_OPTIONS="--max-old-space-size=8192"
NODE_OPTIONS="--max-old-space-size=8192" pnpm test 2>&1 | grep -E "Tests "
# Verwacht: "Tests  47 passed (47)"
```

Stop bij rood.

---

### Step 1 — Schema additions

Edit `prisma/schema.prisma`:

1. **Voeg 10 enums toe** in de "ENUMS" sectie (na bestaande `WithdrawalStatus`):
   `BetStatus`, `SettlementMode`, `ResultStatus`, `MatchStatus`, `PoolStatus`, `DisputeStatus`, `DisputeOutcome`, `ReputationTier`, `EvidenceType`, `ConfirmationDecision`. Exact zoals in beslissingen #3, #4, #5, #13, #16, #18, #21, #8 (EvidenceType), #10 (ConfirmationDecision).

2. **Voeg 12 nieuwe modellen toe** in de "MODELS" sectie (na `CircuitBreaker`): `Bet`, `BetParticipant`, `BetInvite`, `BetEvidence`, `BetStateTransition`, `BetParticipantConfirmation`, `BetResultClaim`, `Match`, `MatchEvidence`, `Pool`, `Dispute`, `UserReputation`. Exacte shapes uit beslissingen #2, #6, #7, #8, #9, #10, #11, #12, #14, #15, #17, #20.

3. **Breid `IdempotencyKey` uit** met 6 nullable kolommen + 2 indexes + 1 unique (zie #19).

4. **Breid `User` uit** met back-relations:
   ```prisma
   // Voeg toe binnen model User { ... }:
   betsCreated                 Bet[]                         @relation("BetCreator")
   betsOpponent                Bet[]                         @relation("BetOpponent")
   betsWon                     Bet[]                         @relation("BetWinner")
   betParticipants             BetParticipant[]
   betInvitesUsed              BetInvite[]
   betEvidence                 BetEvidence[]
   betStateTransitions         BetStateTransition[]
   confirmations               BetParticipantConfirmation[]  @relation("ConfirmationActor")
   confirmationsClaimedAsWinner BetParticipantConfirmation[] @relation("ConfirmationClaimedWinner")
   resultClaims                BetResultClaim[]              @relation("ResultClaimActor")
   resultClaimsAsWinner        BetResultClaim[]              @relation("ResultClaimWinner")
   matchEvidence               MatchEvidence[]
   poolsCreated                Pool[]                        @relation("PoolCreator")
   disputesOpened              Dispute[]                     @relation("DisputeOpener")
   disputesResolved            Dispute[]                     @relation("DisputeResolver")
   reputation                  UserReputation?
   idempotencyKeys             IdempotencyKey[]
   ```

5. **Validate:**
   ```bash
   pnpm prisma format
   pnpm prisma validate
   ```
   Beide moeten exit 0 + "schema is valid".

---

### Step 2 — `src/lib/fees.ts` + tests

1. Maak `src/lib/fees.ts` (zie #23 voor exacte inhoud).

2. Maak `src/__tests__/money/fees.test.ts`:
   ```typescript
   import { describe, expect, it } from "vitest";
   import { FEES, applyBps, calcDisputeDeposit, calcWithdrawalFee } from "@/lib/fees";

   describe("fees module", () => {
     it("applyBps computes 2% of 100 USDC = 2 USDC (floor math)", () => {
       const pot = 100_000_000n;       // 100 USDC
       expect(applyBps(pot, FEES.PLATFORM_BPS)).toBe(2_000_000n);
     });

     it("applyBps floors fractional BPS results", () => {
       // 1.5% van 99 USDC = 1.485 USDC = 1485000.??? → floor naar 1_485_000n
       expect(applyBps(99_000_000n, 150)).toBe(1_485_000n);
     });

     it("calcDisputeDeposit applies $0.50 minimum floor", () => {
       // 10% van 1 USDC = 0.10 USDC = 100_000n → bumped to 500_000n minimum
       expect(calcDisputeDeposit(1_000_000n)).toBe(500_000n);
       // 10% van 100 USDC = 10 USDC → no floor needed
       expect(calcDisputeDeposit(100_000_000n)).toBe(10_000_000n);
     });

     it("calcWithdrawalFee clamps min $0.10 / max $5.00", () => {
       // 1% van 5 USDC = 0.05 USDC → bumped to 0.10
       expect(calcWithdrawalFee(5_000_000n)).toBe(100_000n);
       // 1% van 10000 USDC = 100 USDC → clamped to 5
       expect(calcWithdrawalFee(10_000_000_000n)).toBe(5_000_000n);
       // 1% van 200 USDC = 2 USDC → in-range
       expect(calcWithdrawalFee(200_000_000n)).toBe(2_000_000n);
     });
   });
   ```

3. **Validate:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=8192" pnpm vitest run src/__tests__/money/fees.test.ts
   # Verwacht: "Tests  4 passed (4)"
   ```

---

### Step 3 — Migration

```bash
# Genereer migration zonder direct toepassen — we moeten trigger handmatig toevoegen
pnpm prisma migrate dev --name add_bet_schema_v1 --create-only
```

Dit creëert `prisma/migrations/<timestamp>_add_bet_schema_v1/migration.sql` met CREATE TABLEs voor alle 12 nieuwe modellen, ALTER TABLE voor IdempotencyKey + User back-relations, CREATE INDEX voor alle indexes.

**Voeg trigger SQL toe aan einde van die migration.sql** (zie #22 voor exacte SQL).

**Apply de migration:**
```bash
NODE_OPTIONS="--max-old-space-size=8192" pnpm prisma migrate dev
# Verwacht: "Already in sync, no schema change or pending migration was found." OF "Applied 1 migration"
```

**Re-generate Prisma client:**
```bash
pnpm prisma generate
```

---

### Step 4 — Smoke tests

Maak `src/__tests__/smoke/bet-schema.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

const SUFFIX = `bet-schema-${Date.now()}`;
const PRIVY_PREFIX = `bs-${SUFFIX}-`;

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      privyId: `${PRIVY_PREFIX}${label}-${Math.random()}`,
    },
  });
}

describe("Bet schema smoke tests", () => {
  beforeEach(async () => {
    await prisma.disputeLog.deleteMany({ where: {} }).catch(() => {});  // table is gone, swallow
    await prisma.dispute.deleteMany({ where: {} });
    await prisma.bet.deleteMany({ where: {} });
    await prisma.match.deleteMany({ where: {} });
    await prisma.pool.deleteMany({ where: { title: { contains: SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.dispute.deleteMany({ where: {} });
    await prisma.bet.deleteMany({ where: {} });
    await prisma.match.deleteMany({ where: {} });
    await prisma.pool.deleteMany({ where: { title: { contains: SUFFIX } } });
    await prisma.user.deleteMany({
      where: { privyId: { startsWith: PRIVY_PREFIX } },
    });
    await prisma.$disconnect();
  });

  it("1. Bet defaults to DRAFT status", async () => {
    const creator = await makeUser("c1");
    const bet = await prisma.bet.create({
      data: {
        createdById: creator.id,
        creatorSide: "A",
        stakeUnits: 5_000_000n,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    expect(bet.status).toBe("DRAFT");
    expect(bet.settlementMode).toBe("PROOF_CONFIRM");
    expect(bet.resultStatus).toBe("PENDING");
    expect(bet.version).toBe(0);
  });

  it("2. BetParticipant @@unique([betId, side]) blocks duplicate", async () => {
    const creator = await makeUser("c2");
    const opponent = await makeUser("o2");
    const bet = await prisma.bet.create({
      data: {
        createdById: creator.id,
        creatorSide: "A",
        stakeUnits: 5_000_000n,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    await prisma.betParticipant.create({
      data: { betId: bet.id, userId: creator.id, side: "A" },
    });
    await expect(
      prisma.betParticipant.create({
        data: { betId: bet.id, userId: opponent.id, side: "A" },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("3. Trigger blocks pool creator betting on own pool", async () => {
    const creator = await makeUser("c3");
    const other = await makeUser("o3");
    const pool = await prisma.pool.create({
      data: {
        createdById: creator.id,
        title: `Test ${SUFFIX}`,
        bettingClosesAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    // Pool creator probeert te betten als creator van een Bet in eigen pool
    await expect(
      prisma.bet.create({
        data: {
          createdById: creator.id,
          opponentUserId: other.id,
          creatorSide: "A",
          stakeUnits: 5_000_000n,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
          poolId: pool.id,
        },
      }),
    ).rejects.toThrow(/Pool creator cannot bet on own pool/i);

    // Maar wel als creator een Bet maakt in iemand anders' pool — moet werken
    const otherCreator = await makeUser("c3b");
    const otherPool = await prisma.pool.create({
      data: {
        createdById: otherCreator.id,
        title: `Other ${SUFFIX}`,
        bettingClosesAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    const okBet = await prisma.bet.create({
      data: {
        createdById: creator.id,  // creator is niet creator van otherPool
        opponentUserId: other.id,
        creatorSide: "A",
        stakeUnits: 5_000_000n,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        poolId: otherPool.id,
      },
    });
    expect(okBet.id).toBeTruthy();
  });

  it("4. IdempotencyKey backward-compat: P05/P06 insert (alleen key+scope) blijft werken", async () => {
    const key = `legacy-test-${SUFFIX}`;
    const row = await prisma.idempotencyKey.create({
      data: { key, scope: "deposit" },
    });
    expect(row.key).toBe(key);
    expect(row.scope).toBe("deposit");
    expect(row.userId).toBeNull();
    expect(row.route).toBeNull();
    expect(row.statusCode).toBeNull();
    await prisma.idempotencyKey.delete({ where: { key } });
  });
});
```

**Run:**
```bash
NODE_OPTIONS="--max-old-space-size=8192" pnpm vitest run src/__tests__/smoke/bet-schema.test.ts
# Verwacht: "Tests  4 passed (4)"
```

---

### Step 5 — Volledige validatie

```bash
rm -f tsconfig.tsbuildinfo
pnpm prisma format
pnpm prisma validate
NODE_OPTIONS="--max-old-space-size=8192" pnpm typecheck
NODE_OPTIONS="--max-old-space-size=8192" pnpm test
# Verwacht totaal: 47 (baseline) + 4 (fees.ts) + 4 (bet-schema smoke) = 55 tests passed
```

Bij rood: stoppen, root cause vinden, niet door naar Step 6.

---

### Step 6 — Commit + tag + push

```bash
git add prisma/schema.prisma \
        prisma/migrations/<timestamp>_add_bet_schema_v1 \
        src/lib/fees.ts \
        src/__tests__/money/fees.test.ts \
        src/__tests__/smoke/bet-schema.test.ts

git status

git commit -m "$(cat <<'COMMIT_MSG'
feat(bet): add 1v1 P2P schema (PROMPT_08, refactor fase 1)

Voegt 13 modellen + 10 enums + 1 trigger + fees.ts module toe
per ADR-0003 en REFACTOR_PLAN.md fase 1.

Modellen:
- Bet (1v1 wager primitief, ~25 fields)
- BetParticipant (@@unique([betId, side]))
- BetInvite (token-hash, constant-time compare via service-laag)
- BetEvidence (sha256 contentHash dedup)
- BetStateTransition (audit log)
- BetParticipantConfirmation (V3, 2-waarde ConfirmationDecision)
- BetResultClaim (V3 only, één claim per user per bet)
- Match (Pool-internal grouping, MatchStatus 4 waardes)
- MatchEvidence (zelfde shape als BetEvidence, EvidenceType gedeeld)
- Pool (vereenvoudigd: geen aggregates, PoolStatus 5 waardes incl. CANCELLED)
- Dispute (admin-decided, opener-only deposit FK naar ledger tx)
- IdempotencyKey EXTENDED (6 nieuwe nullable velden, P05/P06 backward-compat)
- UserReputation (schema only, abuse-prevention logic in P14)

Enums:
- BetStatus (10 waardes), SettlementMode (PROOF_CONFIRM only)
- ResultStatus, MatchStatus, PoolStatus (vernieuwd)
- DisputeStatus, DisputeOutcome, ReputationTier
- EvidenceType (gedeeld door Bet+Match Evidence), ConfirmationDecision

Trigger:
- bets_creator_cannot_bet_on_own_pool_match (BEFORE INSERT/UPDATE
  on bets, plpgsql, raise exception als pool creator zichzelf
  als bet creator of opponent zet)

Module:
- src/lib/fees.ts: FEES constant + applyBps() + calcDisputeDeposit()
  + calcWithdrawalFee(). Single source of truth — geen hardcoded
  percentages elders.

Tests:
- src/__tests__/money/fees.test.ts (4 tests, BPS math + clamping)
- src/__tests__/smoke/bet-schema.test.ts (4 tests, DRAFT default,
  BetParticipant uniqueness, trigger werking, IdempotencyKey
  backward-compat)

Test count: 47 -> 55.

Reference: REFACTOR_PLAN.md beslissingen 1-6 + ADR-0003 §1-8.
Pre-PROMPT_09 (createBet/acceptBet/cancelBet services).
COMMIT_MSG
)"

git tag refactor-fase-1
git log --oneline -5
git push origin main
git push origin refactor-fase-1
```

---

## Post-flight checks

```bash
# 1. Schema heeft alle 13 modellen
grep -cE "^model (Bet|BetParticipant|BetInvite|BetEvidence|BetStateTransition|BetParticipantConfirmation|BetResultClaim|Match|MatchEvidence|Pool|Dispute|IdempotencyKey|UserReputation)\b" prisma/schema.prisma
# Verwacht: 13

# 2. 10 nieuwe enums in schema
grep -cE "^enum (BetStatus|SettlementMode|ResultStatus|MatchStatus|PoolStatus|DisputeStatus|DisputeOutcome|ReputationTier|EvidenceType|ConfirmationDecision)\b" prisma/schema.prisma
# Verwacht: 10

# 3. Trigger werkt — geverifieerd via smoke test #3
# (ook query-bare:)
pnpm prisma db execute --schema=prisma/schema.prisma --stdin <<<"SELECT tgname FROM pg_trigger WHERE tgname = 'bets_creator_cannot_bet_on_own_pool_match';"
# Verwacht: 1 row

# 4. Geen hardcoded fee numbers buiten fees.ts
grep -nE "(200|1500|1000)\s*(\)|;|,)" src/lib/ --include="*.ts" | grep -v "src/lib/fees.ts"
# Verwacht: alleen niet-fee context (bv. timeouts, units conversion)
# Manuele review nodig — geen automatische assertion

# 5. Test count
NODE_OPTIONS="--max-old-space-size=8192" pnpm test 2>&1 | grep "Tests"
# Verwacht: "Tests  55 passed (55)"

# 6. IdempotencyKey kolommen aanwezig
pnpm prisma db execute --schema=prisma/schema.prisma --stdin <<<"SELECT column_name FROM information_schema.columns WHERE table_name='idempotency_keys' ORDER BY column_name;"
# Verwacht: completed_at, created_at, expires_at, key, response_json, route, scope, status_code, user_id (9 columns)
```

---

## Wat dit NIET doet

- **Geen services.** Geen `createBet`, `acceptBet`, `cancelBet`, `placeBet`, etc. Komt in **PROMPT_09**.
- **Geen HTTP routes.** Komen in PROMPT_16.
- **Geen UI.** Komt in PROMPT_17+.
- **Geen UserReputation update-logic.** Schema staat klaar; logic (score recompute, tier transitions, dispute-rate calc) komt in **PROMPT_14**.
- **Geen invariant cron uitbreiding.** P07's `ReconciliationLog` wordt niet aangepast in P08; nieuwe Bet-aware invariants komen in **PROMPT_15**.
- **Geen fee-collectie code.** `applyBps` is een pure helper; gebruik ervan in `placeBet`/`settle` komt P09/P10.
- **Geen circuit-breaker uitbreiding voor `bets`.** Bestaande breakers (`deposits`, `withdrawals`, `settlement`) worden niet aangeraakt. Een `bets` breaker key kan post-MVP worden toegevoegd.
- **Geen seed data.** Geen Bet/Pool/Match seed in `prisma/seed.ts`.

---

## Volgende stap

Na user-akkoord op deze spec:
- **Stop voor review.** User leest dit document en geeft groen licht of correcties.
- **Daarna uitvoeren** in een latere Claude Code sessie via Steps 0-6.
- Bij groen Step 5: fase 1 commit + tag + push, dan PROMPT_09 spec schrijven (createBet/acceptBet/cancelBet).

---

## Beslissingen op open questions

Acht punten doorgesproken; alle beslissingen vastgelegd.

1. **Enum count: 10 (bevestigd).** Post-flight check 2 verifieert exact 10 enums (`BetStatus`, `SettlementMode`, `ResultStatus`, `MatchStatus`, `PoolStatus`, `DisputeStatus`, `DisputeOutcome`, `ReputationTier`, `EvidenceType`, `ConfirmationDecision`).

2. **`Bet.matchId` zonder `poolId`: DB CHECK toegevoegd.** Constraint `bet_match_requires_pool CHECK (match_id IS NULL OR pool_id IS NOT NULL)` staat in migration.sql na de trigger (zie #22). Defense-in-depth bovenop service-layer guard in `createBet` (zie #2). De inverse — `(poolId, NULL)` — blijft toegestaan: een Bet kan in een Pool zitten zonder Match-binding (zeldzaam maar niet verboden).

3. **`BetResultClaim` + `BetParticipantConfirmation`: beide behouden.** Twee rollen, twee tabellen. ResultClaim = "ik claim dat X de winnaar is" (initiator van settlement). Confirmation = "ik bevestig of ben oneens met de bestaande claim" (vervolgactie). Wager V3 pattern. Geen consolidatie naar één tabel.

4. **`ConfirmationDecision`: 2 waardes (bevestigd).** `CONFIRM_WINNER` (met `claimedWinnerId`) + `DISAGREE`. Wager's 5-waarde enum is over-gespecificeerd voor zentrix scope.

5. **`Match.eventTime` nullable (bevestigd).** Niet alle bets hebben event-tijd ("wie scoort eerst dit weekend"-type bets). Service-layer hint aan UI om aan te raden, geen DB-niveau verplichting.

6. **`PoolStatus` uitgebreid met `CANCELLED`.** Was 4, wordt 5: `DRAFT, OPEN, CLOSED, SETTLED, CANCELLED`. Alleen `DRAFT → CANCELLED` toegestaan — `cancelPool` service in P11 enforced dit. OPEN/CLOSED pools kunnen niet gecancelled worden (escrow staat). Zie #16 voor transition rules.

7. **`Dispute` zonder `version` veld (bevestigd).** Status-guard via `updateMany({where: {id, status: <prev>}})` is functioneel equivalent met version-based optimistic lock, simpler.

8. **Geen aparte mismatch audit-log tabel (bevestigd).** Service-layer error log voor `IdempotencyKey` mismatch-replays volstaat voor MVP. Aparte `IdempotencyAuditLog` tabel kan post-MVP indien klantgedrag het rechtvaardigt.

Spec is uitvoeringsklaar. Wachten op final akkoord voor Step 0 start.
