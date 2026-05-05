# Phase 2 Preview — Event / Pool / Organization Framework

**Status:** Preview document. **Geen prompt om uit te voeren.** Dit document legt de scope van fase 2 vast zodat (a) je tijdens fase 1 niets bouwt dat fase 2 blokkeert, en (b) we later geen scope-creep krijgen.

**Lees dit nadat je `LESSONS_FROM_WAGER.md` en `ADR-0001-architecture.md` hebt gelezen, en voordat je aan PROMPT_01 begint.**

---

## Productdefinitie — wat Zentrix is

Zentrix is een **infrastructuur-platform voor pool-based wedden op events**. Drie partijen, drie verantwoordelijkheden:

| Partij | Wat ze doen | Wat ze verdienen |
|---|---|---|
| **Zentrix (jij)** | Custody, ledger, settlement engine, payouts | Platform fee (bv. 5%) per pool |
| **Organization** | Event maken, pool opzetten, resultaten invoeren (= result authority) | Organization fee (bv. 3-5%) per pool |
| **User** | Wedden op uitkomst van een event/match | Hun aandeel van de prize pool als ze winnen |

De kernbelofte van Zentrix: **gebruikers kunnen vertrouwen dat geld er is, eerlijk wordt uitbetaald, en dat de organisatie niet stiekem fees of regels kan veranderen nadat zij hebben ingelegd.**

## Voorbeelden van wat een organization kan maken

```
Boxing Night                       Football Tournament              Basketball League
  → Fighter A vs Fighter B           → Team A vs Team B               → Lakers vs Celtics
  → Winner pool                      → Winner pool                    → Over/under points pool
                                     → Exact score pool
                                     → Custom prediction pool
```

**Productnaam intern:** "Event Pool Builder" of gewoon "Pools". Niet "fight pool" — dat is te smal.

---

## Datamodel — fase 2

Hieronder de modellen die in fase 2 erbij komen. **Geen `Wager` of `Bet` model.** Het oude Wager-platform was 1-op-1; Zentrix is pool-based — fundamenteel anders.

### 1. Organization

```prisma
model Organization {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  slug        String   @unique
  /// Default fee for pools created by this org. Per-pool override allowed
  /// at creation time, but locked once first user joins.
  defaultFeeBps Int    @default(300) @map("default_fee_bps") // 3%
  status      OrganizationStatus @default(ACTIVE)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  owner       User     @relation(fields: [ownerId], references: [id])
  members     OrganizationMember[]
  events      Event[]
  pools       Pool[]
}

enum OrganizationStatus {
  ACTIVE
  SUSPENDED
  CLOSED
}

/// Roles per organization (members table — many-to-many).
model OrganizationMember {
  id             String   @id @default(uuid())
  organizationId String   @map("organization_id")
  userId         String   @map("user_id")
  role           OrgRole  @default(STAFF)
  createdAt      DateTime @default(now()) @map("created_at")

  organization   Organization @relation(fields: [organizationId], references: [id])
  user           User         @relation(fields: [userId], references: [id])

  @@unique([organizationId, userId])
}

enum OrgRole {
  OWNER       // can do everything
  ADMIN       // can manage events + pools + finalize results
  STAFF       // can manage events + pools, can propose results
  VIEWER      // read-only
}
```

### 2. Event + Match

```prisma
model Event {
  id             String   @id @default(uuid())
  organizationId String   @map("organization_id")
  title          String
  description    String?
  sportType      SportType @map("sport_type")
  location       String?
  startsAt       DateTime @map("starts_at")
  status         EventStatus @default(DRAFT)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization   Organization @relation(fields: [organizationId], references: [id])
  matches        EventMatch[]
  pools          Pool[]

  @@index([organizationId, startsAt])
}

enum SportType {
  BOXING
  MMA
  FOOTBALL
  BASKETBALL
  ESPORTS
  TENNIS
  CUSTOM
}

enum EventStatus {
  DRAFT       // organization is editing
  OPEN        // accepting pool entries
  LIVE        // event ongoing, pools locked
  ENDED       // event finished, awaiting results
  CANCELLED   // event cancelled — all pools refund
}

model EventMatch {
  id             String      @id @default(uuid())
  eventId        String      @map("event_id")
  name           String      // "Team A vs Team B"
  participantA   String      @map("participant_a")
  participantB   String      @map("participant_b")
  startsAt       DateTime    @map("starts_at")
  status         MatchStatus @default(SCHEDULED)
  createdAt      DateTime    @default(now()) @map("created_at")

  event          Event       @relation(fields: [eventId], references: [id])
  pools          Pool[]
}

enum MatchStatus {
  SCHEDULED
  LOCKED      // betting closed, match in progress or about to start
  FINISHED    // result known but not necessarily proposed yet
}
```

### 3. Pool + PoolOption + PoolEntry

```prisma
model Pool {
  id                  String   @id @default(uuid())
  organizationId      String   @map("organization_id")
  eventId             String?  @map("event_id")
  matchId             String?  @map("match_id")
  /// Snapshot of organization fee at pool creation. LOCKED once
  /// firstEntryAt is non-null. Cannot be changed after — R7-style
  /// validation at intake of new entries.
  organizationFeeBps  Int      @map("organization_fee_bps")
  /// Snapshot of platform fee at pool creation. Same locking rule.
  platformFeeBps      Int      @map("platform_fee_bps")
  type                PoolType
  title               String
  description         String?
  /// Required stake to enter (uniform across all entries in v1).
  /// In v2 we may add free-stake pools where users pick their own amount.
  stakeUnits          BigInt   @map("stake_units")
  /// Cached sum of all entry stakes — derived; updated by ledger transactions.
  totalPotUnits       BigInt   @default(0) @map("total_pot_units")
  status              PoolStatus @default(OPEN)
  /// When status transitions OPEN → LOCKED automatically (cron-driven).
  lockAt              DateTime @map("lock_at")
  /// Set by recordTransaction when first entry comes in. Used for fee-lock.
  firstEntryAt        DateTime? @map("first_entry_at")
  /// FK to FinancialAccount of accountType=POOL_ESCROW for this pool.
  escrowAccountId     String?  @unique @map("escrow_account_id")
  /// Optimistic version lock — every transition bumps this.
  version             Int      @default(0)
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  organization        Organization @relation(fields: [organizationId], references: [id])
  event               Event?       @relation(fields: [eventId], references: [id])
  match               EventMatch?  @relation(fields: [matchId], references: [id])
  options             PoolOption[]
  entries             PoolEntry[]
  result              PoolResult?
}

enum PoolType {
  WINNER       // pick winning participant
  SCORE        // exact score
  METHOD       // KO / decision / draw etc.
  OVER_UNDER   // total over/under N
  CUSTOM       // free-form question
}

enum PoolStatus {
  OPEN              // accepting entries
  LOCKED            // entries closed, awaiting result
  RESULT_PROPOSED   // org has proposed a winner; dispute window open
  DISPUTED          // user disputed within window
  FINALIZED         // result locked in, ready for payout
  SETTLING          // payouts in progress
  SETTLED           // all payouts complete
  CANCELLED         // event cancelled or pool void
  REFUNDED          // all entries refunded
}

model PoolOption {
  id          String   @id @default(uuid())
  poolId      String   @map("pool_id")
  label       String   // "Team A", "Team B", "Draw", "Over 2.5"
  /// Machine-readable key. For WINNER pool: "team_a", "team_b", "draw".
  /// For OVER_UNDER: "over", "under".
  resultKey   String   @map("result_key")
  /// Display order for UI.
  sortOrder   Int      @default(0) @map("sort_order")

  pool        Pool        @relation(fields: [poolId], references: [id])
  entries     PoolEntry[]

  @@unique([poolId, resultKey])
}

model PoolEntry {
  id          String   @id @default(uuid())
  poolId      String   @map("pool_id")
  userId      String   @map("user_id")
  optionId    String   @map("option_id")
  stakeUnits  BigInt   @map("stake_units")
  status      EntryStatus @default(ACTIVE)
  /// FK to LedgerTransaction that recorded the stake debit.
  ledgerTxId  String?  @map("ledger_tx_id")
  /// Filled when payout occurs.
  payoutTxId  String?  @map("payout_tx_id")
  payoutUnits BigInt?  @map("payout_units")
  createdAt   DateTime @default(now()) @map("created_at")

  pool        Pool       @relation(fields: [poolId], references: [id])
  user        User       @relation(fields: [userId], references: [id])
  option      PoolOption @relation(fields: [optionId], references: [id])

  /// One entry per (pool, user) in v1. Pools that allow multiple entries
  /// per user (each on a different option) come later — relax this constraint.
  @@unique([poolId, userId])
  @@index([poolId, status])
  @@index([userId, createdAt])
}

enum EntryStatus {
  ACTIVE
  WON
  LOST
  REFUNDED
  VOIDED
}
```

### 4. PoolResult — de result authority laag

Dit is waar **organization als result authority** wordt afgedwongen.

```prisma
model PoolResult {
  id                  String   @id @default(uuid())
  poolId              String   @unique @map("pool_id")
  /// FK to PoolOption — the winning option.
  winningOptionId     String   @map("winning_option_id")
  /// User from the organization who proposed the result.
  proposedByUserId    String   @map("proposed_by_user_id")
  /// Role at time of proposal (snapshot, in case role changes later).
  proposedByRole      OrgRole  @map("proposed_by_role")
  proposedAt          DateTime @default(now()) @map("proposed_at")
  /// Dispute window closes at this time. After this, finalize is allowed.
  disputeWindowClosesAt DateTime @map("dispute_window_closes_at")
  /// When status moved to FINAL.
  finalizedAt         DateTime? @map("finalized_at")
  /// Free-text evidence link (URL to scoreboard, video, news article).
  evidenceUrl         String?   @map("evidence_url")
  status              ResultStatus @default(PROPOSED)
  /// Audit log: every change to this row appends to PoolResultAudit.
  version             Int      @default(0)

  pool                Pool       @relation(fields: [poolId], references: [id])
  proposedBy          User       @relation("ResultProposer", fields: [proposedByUserId], references: [id])
  winningOption       PoolOption @relation(fields: [winningOptionId], references: [id])
  audits              PoolResultAudit[]
  disputes            PoolDispute[]
}

enum ResultStatus {
  PROPOSED   // org proposed; dispute window open
  DISPUTED   // user disputed; needs platform admin review
  FINAL      // dispute window closed, no disputes — settlement allowed
  OVERRIDDEN // platform admin overrode the result during dispute
}

model PoolResultAudit {
  id          String   @id @default(uuid())
  resultId    String   @map("result_id")
  /// Snapshot of the previous winningOptionId; null if first proposal.
  fromOptionId String?  @map("from_option_id")
  toOptionId   String   @map("to_option_id")
  changedBy    String   @map("changed_by")
  changedAt    DateTime @default(now()) @map("changed_at")
  reason       String?

  result       PoolResult @relation(fields: [resultId], references: [id])
}

model PoolDispute {
  id          String   @id @default(uuid())
  resultId    String   @map("result_id")
  raisedByUserId String @map("raised_by_user_id")
  raisedAt    DateTime @default(now()) @map("raised_at")
  reason      String
  evidenceUrl String?  @map("evidence_url")
  /// Resolved by platform admin: UPHELD = result was wrong, REJECTED = stands.
  resolution  DisputeResolution?
  resolvedAt  DateTime? @map("resolved_at")
  resolvedBy  String?   @map("resolved_by")

  result      PoolResult @relation(fields: [resultId], references: [id])
}

enum DisputeResolution {
  UPHELD     // dispute won; result is overridden
  REJECTED   // dispute rejected; original result stands
}
```

---

## Geldflow — fase 2

Wat er gebeurt bij elk pool-event in termen van de bestaande ledger:

### Pool creation (door organization)

Geen geldflow. Een `Pool` row wordt aangemaakt met `status=OPEN`. Er wordt een `FinancialAccount` aangemaakt van type `POOL_ESCROW` met `scopeKey=pool:<id>`.

### User entry

```
USER (acct=user:X)        →    POOL_ESCROW (acct=pool:Y)
        stakeUnits                  stakeUnits

  ledgerEntryType: ESCROW_LOCK
  idempotencyKey: pool-entry:<entryId>
```

Dit is **exact** dezelfde patroon als `holdForBet` in de oude Wager — die heb ik ge-port als skelet in de ledger module van fase 1. De ledger ondersteunt dit zonder schema-wijziging.

### Pool lock (cron, automatisch op `lockAt`)

Geen geldflow. Pool `status: OPEN → LOCKED`. `version + 1`.

### Result proposed

Geen geldflow. `PoolResult.status = PROPOSED`. Cron schedule een `disputeWindowClosesAt`.

### Result finalized (na dispute window)

Geen geldflow. `PoolResult.status = FINAL`. Triggered door `pool-finalize` cron die elke minuut kijkt of `disputeWindowClosesAt < NOW()` voor PROPOSED-results zonder open disputes.

### Settlement

Voor elke PoolEntry op het winnende option:

```
POOL_ESCROW (acct=pool:Y)  →   USER (acct=user:winner)
       payoutPerWinner             payoutPerWinner

  ledgerEntryType: SETTLEMENT_PAYOUT
  idempotencyKey: pool-payout:<entryId>
```

En voor de fees (één keer per pool):

```
POOL_ESCROW   →   TREASURY (platform fee)
POOL_ESCROW   →   ORG_REVENUE (organization fee)

  ledgerEntryType: FEE_COLLECTION
  idempotencyKey: pool-fee-platform:<poolId>, pool-fee-org:<poolId>
```

Conservation invariant: `pot = sum(payouts) + platformFee + orgFee`. Floor-rounding: payouts get the rounding crumb (anti-platform-bias), as Wager arrived at after audit.

### Cancellation / refund

```
For each entry in pool:
  POOL_ESCROW   →   USER
        stakeUnits         stakeUnits
  ledgerEntryType: ESCROW_RELEASE
  idempotencyKey: pool-refund:<entryId>
```

Geen fees op refunds.

---

## Organisatie als result authority — het veiligheidsmodel

De gevoelige vraag: organisaties bepalen winnaars, hoe voorkom je misbruik?

### Vijf afdwingingen

1. **Resultaat kan niet vóór `lockAt + grace period`.** Een organisatie kan dus niet de winnaar invoeren voor een match die nog niet gespeeld is.

2. **Dispute window is niet-skipbaar.** Configureerbaar per pool, default 1 uur. Zelfs als de organisatie en alle users akkoord zijn, kan de finalize-cron niet eerder draaien.

3. **Result audit log.** Elke wijziging van `PoolResult.winningOptionId` (via `PoolResultAudit`) is permanent. Een organisatie die de winnaar drie keer wijzigt, bouwt zichtbaar wantrouwen op.

4. **Platform admin override.** Een dispute door een gebruiker kan door een platform admin worden behandeld. Override-mogelijkheid bestaat — gebruiker krijgt geld terug als override `UPHELD`.

5. **Fees zijn locked vanaf eerste entry.** Geen "achteraf de fee verhogen". `Pool.firstEntryAt` is een snapshot punt; vanaf dan zijn `platformFeeBps` en `organizationFeeBps` immutable. Schema check in code, en optionally een DB trigger.

### Audit log queries (admin tool)

```sql
-- Alle pools waar de organisatie de winnaar > 1x heeft gewijzigd
SELECT pool_id, COUNT(*) as changes
FROM pool_result_audits
GROUP BY pool_id
HAVING COUNT(*) > 1;

-- Organisaties met disputes ratio > 5%
SELECT
  o.name,
  COUNT(DISTINCT p.id) as total_pools,
  COUNT(DISTINCT pd.id) as disputed_pools,
  ROUND(100.0 * COUNT(DISTINCT pd.id) / COUNT(DISTINCT p.id), 2) as dispute_pct
FROM organizations o
JOIN pools p ON p.organization_id = o.id
LEFT JOIN pool_results pr ON pr.pool_id = p.id
LEFT JOIN pool_disputes pd ON pd.result_id = pr.id
GROUP BY o.id, o.name
HAVING COUNT(DISTINCT p.id) >= 10
ORDER BY dispute_pct DESC;
```

Deze worden routes in `/api/admin/orgs/<id>/health` en exposed als metrics in prompt 07's Prometheus endpoint (R9 — observable per feature).

---

## MVP-scope voor fase 2

Niet alles uit het datamodel hierboven is fase 2. **Strikt MVP:**

1. ✅ Organization + 1 owner, geen members nog (owner doet alles)
2. ✅ Event aanmaken (simpel — title, sportType, startsAt)
3. ✅ Match toevoegen aan event
4. ✅ Winner-pool maken (alleen `PoolType.WINNER`)
5. ✅ User joinen (één entry per user per pool)
6. ✅ Pool auto-lock op `lockAt` (Vercel cron)
7. ✅ Result voorstellen (door organization owner)
8. ✅ Dispute window (default 1 uur, hardcoded — config in fase 3)
9. ✅ Auto-finalize na dispute window (cron)
10. ✅ Auto-payout naar winnaars + platform fee + organization fee

**Expliciet niet in fase 2 (komt in fase 3 of later):**

- ❌ Bracket pools (knockout-style)
- ❌ Score-prediction pools, over/under, custom
- ❌ Multiple entries per user (split bets)
- ❌ Private invite-only pools
- ❌ QR-code joining voor live events
- ❌ Live leaderboard tijdens event
- ❌ Multiple pools per match (komt vanzelf, maar UI later)
- ❌ Organization members (alleen owner-mode in fase 2)
- ❌ Dispute resolution UI voor users (admin handelt af buiten platform)
- ❌ KYC, age verification, geo-restrictions (zie compliance hieronder)

---

## Compliance — de juridische punten die je terecht noemde

**Curaçao LOK** en **Spanje DGOJ** zijn relevant zodra Zentrix users in die markten accepteert die geld inleggen en kunnen winnen. Dit is **gereguleerd gokken**.

### Verplichte technische voorbereidingen (komen in fase 3)

| Vereiste | Wat het betekent | Waar het in het schema komt |
|---|---|---|
| **KYC** | Identiteit van users vaststellen vóór withdrawals boven een drempel | `User.kycStatus`, `KycSubmission` model, integratie met Onfido / SumSub |
| **Age verification** | 18+ check (of 21+ in sommige markten) | Onderdeel van KYC, `User.dateOfBirth` (verified) |
| **Geo restrictions** | Bepaalde landen blokkeren | `User.country` (IP + KYC), per-organization allowlist/blocklist |
| **Responsible gambling** | Self-exclusion, deposit limits, cool-off periods | `User.selfExcludedUntil`, `DepositLimit`, etc. |
| **Audit logs** | Alle financial events traceable per user voor 5+ jaren | Heb je al via `LedgerEntry` retention; voeg `auditLog` voor user actions toe |
| **Dispute records** | Permanent record van disputes en resoluties | `PoolDispute` (al in dit document) |
| **Fee transparency** | Users zien fees vóór ze inleggen | UI requirement, geen schema |
| **Transaction history** | Self-service download van alle bewegingen | API endpoint dat `LedgerEntry` rows voor user dumpt naar CSV/JSON |

### Wat je vóór fase 3 moet doen

1. **Beslissen waar Zentrix opereert.** "Heel Europa" is niet realistisch zonder licenties. Begin smal: bv. Nederland (waar gokken via KSA gelicenseerd is) of vraag een Curaçao license via een agent. Spanje heeft DGOJ met aparte aanvragen per spelvorm.

2. **Bepalen of "pool betting tussen users" als gokken telt.** In de meeste jurisdicties: ja, zodra het geld is en uitkomst onzeker is. "Skill-based" claims zijn juridisch wankel — niet op rekenen.

3. **Bepalen of organisaties die pools maken óók een licentie nodig hebben.** Variabel per land — als Zentrix de operator is en de organisatie een "agent" of "promotor", kan dat onder Zentrix's licentie vallen.

4. **Een gokjurist consulteren vóór live launch in een EU-markt.** Ik kan je hiermee niet helpen — Claude is geen advocaat. Maar ik kan helpen met de technische compliance hooks in het schema (zie tabel hierboven) zodat je de juiste data verzamelt.

**Mijn ontwerp-suggestie:** bouw fase 1 en fase 2 met **alle compliance hooks erin als feature flags die default false staan**. Bij launch in een gereguleerde markt zet je de flags aan. Dit voorkomt een rewrite later.

---

## Wat fase 1 al goed doet voor fase 2

De prompts 01-07 zijn ontworpen zodat fase 2 een **toevoeging** is, geen **herschrijving**:

| Fase 1 element | Hoe fase 2 erop bouwt |
|---|---|
| `AccountType.BET_ESCROW` enum waarde | Hernoem naar `POOL_ESCROW` in fase 2 — één migration, geen breaking change |
| `LedgerTransaction.refType` + `refId` | Wordt `pool` / `pool-entry` / `pool-payout` / `pool-fee-org` |
| `LedgerEntryType.ESCROW_LOCK / ESCROW_RELEASE / SETTLEMENT_PAYOUT / FEE_COLLECTION` | Direct herbruikbaar |
| `recordTransaction()` met idempotency keys | Direct herbruikbaar voor pool-entries en payouts |
| FOR UPDATE locks op accounts | Beschermt tegen concurrent pool entries |
| Drie invariant tests in CI | Blijven gelden — pool flows moeten ze respecteren |
| Circuit breakers (`deposits`, `withdrawals`, `settlement`) | Voeg `pool-entries` en `pool-settlement` toe |
| Recon engine | Breidt uit: pool escrow totals = sum van active entries |
| `parseSolanaAddress` validator (R7) | Niet direct nodig in pool flow (geen on-chain transfers per entry), wel voor org payout addresses |

---

## Wat ik je in fase 2 ga leveren

Wanneer je fase 1 deploybaar hebt en mij om fase 2 vraagt, krijg je:

| Prompt | Inhoud |
|---|---|
| `PROMPT_08_organizations.md` | Organization + OrganizationMember models + onboarding flow + admin route |
| `PROMPT_09_events_matches.md` | Event + EventMatch models + CRUD API |
| `PROMPT_10_pools_intake.md` | Pool + PoolOption models + pool creation + entry intake (met fee-lock) |
| `PROMPT_11_pool_lock.md` | Auto-lock cron + state machine |
| `PROMPT_12_results_disputes.md` | PoolResult + audit + dispute model + admin override |
| `PROMPT_13_pool_settlement.md` | Settlement engine + payout + fee splits |
| `PROMPT_14_pool_observability.md` | Pool-specifieke metrics + recon uitbreiding + admin dashboard data |

Geschat: 2-3 weken werk (bouwtijd + manueel testen), assuming fase 1 stabiel is.

---

## Wat je nu (tijdens fase 1) moet onthouden

1. **Niet stiekem `Pool` of `Event` modellen aan het fase 1 schema toevoegen.** Houd het schoon. Voeg toe via fase 2 prompts wanneer het tijd is.

2. **Niet stiekem fees of fee-splitting toevoegen aan deposits/withdrawals.** Fee-splits zijn een pool-concept, niet een deposit/withdrawal-concept.

3. **Wel: bij elke fase 1 PR, vraag jezelf af "blokkeert dit fase 2?"** Als het antwoord ja is, herontwerp.

4. **Geen pool-, event-, of organisatie-UI bouwen in fase 1.** Het MVP UI van fase 1 is: login + dashboard met balance + deposit/withdrawal forms. Niets meer.

5. **Wel mogen: stub-routes met een 501 "coming in phase 2" response** als je wilt experimenteren met de routing structuur. Dat blokkeert niets.
