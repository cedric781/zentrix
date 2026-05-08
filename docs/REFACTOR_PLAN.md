# REFACTOR_PLAN — PROMPT_08-09 unwind naar 1v1 P2P

**Status:** Draft (awaiting user approval)
**Datum:** 2026-05-09
**Reference:** [ADR-0003](./ADR-0003-1v1-with-tournament-pools.md) (commit `e9fc0c5`)

---

## 1. Doel

PROMPT_08-09 implementeerden het parimutuel pool model uit ADR-0002. ADR-0003 (geaccepteerd 2026-05-09) supersedeert dat model: Zentrix bouwt op een 1-on-1 Bet primitief, met Pool als optionele tournament-container van N matches.

Dit document plant de unwind: welke commits/files/migrations weg moeten, wat blijft, in welke volgorde nieuwe artefacten gebouwd worden, en wat de rollback-paden zijn als we onderweg een fout tegenkomen.

**Einddoel:** een schone `main` branch met:
- PROMPT_01-07 werk volledig intact (ledger, recon, withdrawals, observability).
- Geen Pool/PoolEntry/DisputeLog/SettlementJob in schema.
- Nieuwe `Bet` + `BetParticipant` + `Match` + `Pool` (vereenvoudigd) + `Dispute` schema, geïntroduceerd via een nieuwe PROMPT_08 sequentie.
- Test suite volledig groen na elke fase.

---

## 2. Wat blijft (untouched)

### Commits behouden (PROMPT_01-07 + ADR-0003)
Alle commits van begin van repo tot en met het laatste niet-P08 werk plus de net-gepushte ADR-0003:

```
6ea7494 ← PROMPT_07 cutoff (laatste commit voor P08-bridge)
…       (alle P01-P07 commits, niet aangetast)
6973c1d fix(test): use threads pool single-thread for windows determinism
e9fc0c5 docs(adr): ADR-0003 1v1 P2P bets with Pool as tournament container
```

`6973c1d` (Windows-determinisme test-fix) is een generieke fix — geen P08-09 dependency, blijft.
`cbc6cb2` (ADR-0002 + P08 spec) blijft als historisch record. ADR-0002 is gesuperseded maar wordt niet uit `docs/` verwijderd; ADR-0003 verwijst er expliciet naar.

### Schema modellen behouden
- `User`
- `FinancialAccount`
- `LedgerTransaction`
- `LedgerEntry` (de bestaande shape; in ADR-0003 referentie als "LedgerEntryV2" wat de Wager-naam is — Zentrix's enkele `LedgerEntry` heeft al de juiste shape).
- `Deposit`
- `Withdrawal`
- `ReconciliationLog`
- `CircuitBreaker`
- `IdempotencyKey` (zie open question 1 — bestaande shape vs. ADR-0003-shape verschil)

### Code behouden
- `src/lib/ledger/` — engine + record + invariants helpers.
- `src/lib/recon/` — reconciliation engine.
- `src/lib/withdrawals/` — withdrawal flow met address-validatie.
- `src/lib/circuit-breaker.ts`
- `src/lib/env.ts` — env config (sommige vars verdwijnen, maar het bestand blijft).
- `src/lib/prisma.ts`
- Tests onder `src/__tests__/` behalve de twee P08-09 specifieke (zie 3b).

### Documenten behouden
- `docs/ADR-0001-architecture.md`
- `docs/ADR-0002-settlement-model.md` (historisch, gesuperseded)
- `docs/ADR-0003-1v1-with-tournament-pools.md` (vers, dit is de gids)
- `docs/LESSONS_FROM_WAGER.md`
- `docs/OPERATOR_PLAYBOOK.md`
- `docs/PHASE_2_DESIGN.md` + `docs/PHASE_2_PREVIEW.md` (parimutuel beschrijvingen — markeren als historisch maar niet verwijderen; eventueel `[SUPERSEDED]` prefix in titel toevoegen)
- `docs/TODO_KNOWN_ISSUES.md`
- `docs/README.md`

---

## 3. Wat moet weg of veranderen (PROMPT_08-09 scope)

### 3a. Schema te verwijderen

In `prisma/schema.prisma`, drop:

**Modellen:**
- `Pool` (regels ~255-287) — bevat `totalSideAUnits`, `totalSideBUnits`, `totalPotUnits`, `sideALabel`, `sideBLabel`, `creatorFeeBps`, lifecycle timestamps. Deze velden zijn parimutuel-specifiek; nieuwe `Pool` model wordt veel kleiner.
- `PoolEntry` (regels ~288-304) — vervangen door `Bet` + `BetParticipant`.
- `DisputeLog` (regels ~306-319) — parimutuel-bound (FK op `Pool`). Vervangen door nieuwe `Dispute` model met admin-decided outcome.
- `SettlementJob` (regels ~321-335) — parimutuel-bound (FK op `Pool`, gebruikt `PoolWinningSide`). Vervangen door per-Match settlement; geen apart cron-job-record nodig (settlement loopt direct na disputewindow expiry).

**Enums:**
- `PoolStatus` — vervangen door nieuwe (vereenvoudigde) `PoolStatus` shape: `DRAFT | OPEN | CLOSED | SETTLED`.
- `PoolSide` — vervangen door `BetSide` of side-strings op `BetParticipant`.
- `PoolWinningSide` — niet meer nodig (Pool resolveert geen sides; Match heeft winnerSide).
- `SettlementStatus` — niet meer nodig.

**Triggers / constraints:**
- `pool_entries_creator_cannot_bet` BEFORE INSERT trigger — verhuist naar `bets`-equivalent (`bets_creator_cannot_bet_on_own_pool_match`).

### 3b. Code te verwijderen

- `src/lib/pools/lifecycle.ts` — `createPool`, `publishPool`, `closePool`, `cancelPool`. Alle 4 muteren parimutuel-specifieke velden.
- `src/lib/pools/escrow.ts` — `getOrCreatePoolEscrowAccount`. Patroon hergebruikt in nieuwe `src/lib/bets/escrow.ts` als `getOrCreateBetEscrowAccount(tx, betId)`.
- `src/lib/pools/errors.ts` — `PoolError` class + 8-code union. Patroon hergebruikt in `src/lib/bets/errors.ts` als `BetError`.
- `src/__tests__/pools/pool-lifecycle.test.ts` — 14 tests, alle voor parimutuel lifecycle. Vervangen door bet-lifecycle tests in fase 2.
- `src/__tests__/financial/pool-escrow-invariant.test.ts` — escrow-invariant test op pool-niveau. Vervangen door bet-escrow-invariant test in fase 1/2.

### 3c. Documenten te verwijderen of vervangen

- `docs/PROMPT_08_pool_schema.md` — vervangen door nieuwe `docs/PROMPT_08_bet_schema.md`.
- `docs/PROMPT_09_pool_lifecycle.md` — vervangen door nieuwe `docs/PROMPT_09_bet_lifecycle.md`.
- `docs/PROMPT_10_place_bet.md` — currently untracked, 1147 lines, never executed. **Plain delete** (geen revert nodig, was nooit gecommit).

### 3d. Migrations strategie

Dev DB heeft geen production data. Drie opties:

**Optie i — `prisma migrate reset` (aanbevolen).**
- `pnpm prisma migrate reset --skip-seed` nukes alle tables + reapplies alle resterende migrations vanaf scratch.
- Daarna verwijderen we de twee parimutuel-migrations uit `prisma/migrations/`:
  - `20260507112514_add_pool_schema/`
  - `20260507152919_add_pool_lifecycle_timestamps/`
- Nieuwe migration wordt gegenereerd vanaf het Bet-schema in nieuwe PROMPT_08.
- **Voordelen:** eenvoudigste, geen migration-drift, schone history.
- **Risico:** verlies van seed data — geen impact want geen prod.

**Optie ii — DROP-migration toevoegen.**
- Nieuwe migration `20260509XXXXXX_drop_parimutuel_schema/migration.sql` met `DROP TABLE pool_entries, pools, dispute_logs, settlement_jobs CASCADE; DROP TYPE PoolStatus, PoolSide, PoolWinningSide, SettlementStatus;`.
- Schema.prisma stripped van Pool/PoolEntry/DisputeLog/SettlementJob.
- Bestaande P08-09 migrations blijven in `prisma/migrations/` als historische record.
- **Voordelen:** behoud van forward-only migration history.
- **Risico:** dubbele complexiteit (twee migrations die elkaar opheffen) zonder reden, want er is geen prod data te beschermen.

**Optie iii — squash + force-push.**
- `git rebase -i 6ea7494` om alle P08-09 commits weg te squashen.
- Force-push naar origin/main.
- **Voordelen:** strakste history.
- **Risico:** history-loss. Niet aanbevolen — ADR-0002 + ADR-0003 zijn nu publieke beslissingen, het is waardevol dat de "we hebben P08-09 gebouwd en daarna omgegooid"-context zichtbaar blijft in git log.

**AANBEVELING: optie ii** (DROP-migration). Forward-only history is industry standard voor production-bound projects. Optie i (`migrate reset`) nukes alle dev data inclusief P05/P06 fixtures, en sluit later production migrations uit. DROP-migration is veilig voor zowel dev als toekomstige prod. Combineren met standaard `git revert` voor commits zou beide concepten door elkaar halen — we doen plain forward-only via een nieuwe `drop_parimutuel_schema` migration die de twee P08-09 migrations functioneel ongedaan maakt zonder hen uit `prisma/migrations/` te verwijderen.

---

## 4. Wat is nieuw (sprint planning)

### Schema (in volgorde van afhankelijkheid, één PROMPT-bestand per cluster)

| # | Artefact | Bron | Prompt |
|---|---|---|---|
| 1 | `Bet` model (~25 fields per ADR-0003 §1) | Wager `Bet` zwaar getrimd | PROMPT_08 |
| 2 | `BetParticipant` met `@@unique([betId, side])` | Wager 1-op-1 | PROMPT_08 |
| 3 | `BetInvite` met token-hash | Wager `BetInvite` | PROMPT_08 |
| 4 | `BetEvidence` met `contentHash` | Wager `BetEvidence` (V3) | PROMPT_08 |
| 5 | `BetStateTransition` audit | Wager `BetStateTransition` | PROMPT_08 |
| 6 | `BetParticipantConfirmation` | Wager V3 | PROMPT_08 |
| 7 | `BetResultClaim` (V3 only — geen V1 erbij) | Wager V3 | PROMPT_08 |
| 8 | `Match` model (Pool-internal grouping) | Nieuw, niet uit Wager | PROMPT_08 |
| 9 | `Pool` model (vereenvoudigd: id, creatorId, title, status, bettingClosesAt) | Nieuw shape | PROMPT_08 |
| 10 | `Dispute` model (admin-decided outcome, opener-only deposit) | Wager `Dispute` V1 trimmed | PROMPT_08 |
| 11 | `IdempotencyKey` extended shape (userId, route, statusCode, responseJson, completedAt, expiresAt) — **of bestaande shape behouden, zie open Q1** | Wager pattern | PROMPT_08 of PROMPT_15 |
| 12 | `UserReputation` model | Wager `UserReputation` | PROMPT_14 (later) |
| 13 | Trigger `bets_creator_cannot_bet_on_own_pool_match` | Wager-pattern adapted | PROMPT_08 |
| 14 | `src/lib/fees.ts` constants module | Wager `src/config/fees.ts` | PROMPT_08 |

### Code modules

| Module | Verantwoordelijk voor | Prompt |
|---|---|---|
| `src/lib/bets/service.ts` | `createBet`, `acceptBet`, `cancelBet`, `proposeResult`, `confirmResult`, `settle` | PROMPT_09, PROMPT_10 |
| `src/lib/bets/errors.ts` | `BetError` class + 10-code union | PROMPT_09 |
| `src/lib/bets/escrow.ts` | `getOrCreateBetEscrowAccount(tx, betId)` — race-safe lazy create | PROMPT_09 |
| `src/lib/bets/idempotency.ts` | `withIdempotency` HTTP-laag wrapper | PROMPT_09 |
| `src/lib/disputes/service.ts` | `openDispute`, `resolveDispute` | PROMPT_13 |
| `src/lib/disputes/abuse.ts` | rate limit + reputation + escalated deposit | PROMPT_14 |
| `src/lib/pools/lifecycle.ts` | `createPool`, `publishPool`, `closePool` (vereenvoudigd, geen aggregates) | PROMPT_11 |
| `src/lib/matches/lifecycle.ts` | `addMatchToPool`, `submitMatchResult` (set winnerSide + dispute window) | PROMPT_12 |
| `src/lib/fees.ts` | platform/dispute/withdrawal fee BPS + helpers | PROMPT_08 |

### Prompt-bestanden sequentie

| Prompt | Scope | Tijdsschatting |
|---|---|---|
| PROMPT_08_bet_schema.md | Schema (modellen + trigger + fees.ts) + smoke tests | 4-6u |
| PROMPT_09_bet_lifecycle.md | createBet, acceptBet, cancelBet + tests | 6-8u |
| PROMPT_10_bet_settlement.md | proposeResult, confirmResult, settle (PROOF_CONFIRM flow) + tests | 6-8u |
| PROMPT_11_pool_lifecycle.md | Pool CRUD (vereenvoudigd) + tests | 3-4u |
| PROMPT_12_match_result.md | submitMatchResult + automatic bet resolution + tests | 4-6u |
| PROMPT_13_dispute.md | openDispute, resolveDispute + tests | 6-8u |
| PROMPT_14_reputation.md | UserReputation snapshots + abuse-prevention | 4-6u |
| PROMPT_15_invariants.md | invariant cron + circuit breaker integratie + tests | 4-6u |
| PROMPT_16+ | HTTP routes, UI components — buiten scope van deze refactor | — |

Totaal refactor tijd: ~37-52u Claude Code werk verdeeld over fasen 1-7.

---

## 5. Stap-voor-stap uitvoering

### Fase 0 — Cleanup (1u)
1. Schrijf nieuwe migration `20260509XXXXXX_drop_parimutuel_schema/migration.sql` met `DROP TABLE pool_entries, dispute_logs, settlement_jobs, pools CASCADE;` + `DROP TYPE "PoolStatus", "PoolSide", "PoolWinningSide", "SettlementStatus";` + drop trigger statement (`DROP TRIGGER IF EXISTS pool_entries_creator_cannot_bet ON pool_entries;` — al weg via cascade, expliciet voor duidelijkheid). Test lokaal met `pnpm prisma migrate dev --name drop_parimutuel_schema`. Verifieer dat `schema.prisma` + migration in sync zijn.
2. Edit `prisma/schema.prisma`: strip `Pool`, `PoolEntry`, `DisputeLog`, `SettlementJob` modellen + `PoolStatus`, `PoolSide`, `PoolWinningSide`, `SettlementStatus` enums. Schema laat nu alleen P01-P07 modellen staan.
3. Delete: `src/lib/pools/`, `src/__tests__/pools/`, `src/__tests__/financial/pool-escrow-invariant.test.ts`.
4. Delete: `docs/PROMPT_08_pool_schema.md`, `docs/PROMPT_09_pool_lifecycle.md`, `docs/PROMPT_10_place_bet.md`. **Bestaande P08-P09 migrations in `prisma/migrations/` blijven staan** (forward-only history, per beslissing 6 in §10).
5. Schrijf `feedback_wager_patterns.md` memory file (per beslissing 5 in §10) onder zentrix-project memory pad.
6. `pnpm prisma format && pnpm prisma validate && pnpm typecheck && pnpm test` — moet groen zijn (zonder P08-09 tests).
7. **Commit:** `refactor(parimutuel-out): drop PROMPT_08-09 schema + services per ADR-0003`. Eén commit voor de hele cleanup (migration + schema + code + docs).
8. **Tag:** `git tag refactor-fase-0` voor rollback safety.
9. Push.

### Fase 1 — Bet schema (4-6u)
1. Schrijf `docs/PROMPT_08_bet_schema.md` (specifications voor 13 modellen + trigger + fees.ts).
2. **Pauze voor user review** van de spec voordat we coden.
3. Run prompt: schema additions, eerste migration, smoke tests, fees.ts module.
4. Validate: `pnpm prisma migrate dev`, typecheck, test.
5. Commit per logische unit (model cluster, trigger, fees.ts).
6. **Tag:** `refactor-fase-1`. Push.

### Fase 2 — Bet lifecycle (6-8u)
1. Schrijf `docs/PROMPT_09_bet_lifecycle.md`.
2. **Pauze voor user review.**
3. Run prompt: `createBet`, `acceptBet`, `cancelBet` services + 15-20 tests.
4. Tag, push.

### Fase 3 — Bet settlement (6-8u)
1. Schrijf `docs/PROMPT_10_bet_settlement.md`.
2. **Pauze voor user review.**
3. Run prompt: `proposeResult`, `confirmResult`, `settle` services + tests.
4. Tag, push.

### Fase 4 — Pool lifecycle (3-4u)
1. Schrijf `docs/PROMPT_11_pool_lifecycle.md`.
2. Pauze voor user review.
3. Run + tag + push.

### Fase 5 — Match result (4-6u)
1. Schrijf `docs/PROMPT_12_match_result.md`.
2. Pauze voor user review.
3. Run + tag + push.

### Fase 6 — Dispute (6-8u)
1. Schrijf `docs/PROMPT_13_dispute.md`.
2. Pauze voor user review.
3. Run + tag + push.

### Fase 7 — Reputation + Invariants (8-12u)
1. Schrijf `docs/PROMPT_14_reputation.md` en `docs/PROMPT_15_invariants.md`.
2. Pauze voor user review.
3. Run beide + tag + push.

Na Fase 7 is de refactor functioneel klaar. HTTP routes + UI volgen in PROMPT_16+ buiten scope van dit document.

---

## 6. Test count tracking

Huidig (HEAD = `e9fc0c5`): **66 tests** (per PROMPT_10 spec post-flight target — feitelijk telling hangt af van vitest run).

| Mijlpaal | Verwachte test count | Delta |
|---|---|---|
| Na Fase 0 (cleanup) | ~52 | −14 (P09 lifecycle tests) tot mogelijk meer (afhankelijk van pool-escrow-invariant test grootte) |
| Na Fase 1 (Bet schema + smoke) | ~60 | +8 schema/trigger smoke tests |
| Na Fase 2 (Bet lifecycle) | ~75 | +15 createBet/acceptBet/cancelBet tests |
| Na Fase 3 (Bet settlement) | ~92 | +17 proposeResult/confirmResult/settle tests inkl. race tests |
| Na Fase 4 (Pool lifecycle) | ~100 | +8 pool CRUD tests (vereenvoudigde set vs. originele 14) |
| Na Fase 5 (Match result) | ~115 | +15 submitMatchResult + auto-resolve tests |
| Na Fase 6 (Dispute) | ~135 | +20 openDispute/resolveDispute/abuse tests |
| Na Fase 7 (Reputation + Invariants) | ~155 | +20 reputation + invariant tests |

**Regel:** elke fase moet groen zijn op `pnpm check` (lint + typecheck + test) voordat we committen. Bij rood: stoppen, root cause vinden, niet voortzetten naar volgende fase.

---

## 7. Risico's en mitigatie

1. **Schema-strip breekt P07 invariant tests.**
   *Mitigatie:* fase 0 voegt geen nieuwe tabellen toe — alleen drops. P07 tests draaien op `LedgerTransaction` + `LedgerEntry` + `FinancialAccount` die niet aangetast worden. Volledige test-run in fase 0 stap 6 vangt regressies.

2. **Nieuwe schema mist een ADR-0003-detail.**
   *Mitigatie:* PROMPT_08-spec gebruikt ADR-0003 §1-8 als checklist. Spec wordt eerst gereviewed voor uitvoering (pauze in fase 1 stap 2).

3. **Migration revert breekt iets in P05/P06 deposits/withdrawals.**
   *Mitigatie:* P05/P06 migrations (`20260505192055_initial_financial_foundation` + eventueel deposits/withdrawals) blijven onaangeraakt — alleen P08+P09-lifecycle migrations worden verwijderd. `prisma migrate reset` reapplyt alleen overgebleven migrations, dus P05/P06 schema komt schoon terug.

4. **Refactor duurt langer dan ingeschat.**
   *Mitigatie:* per-fase commit + push + tag. Op elk moment kunnen we pauzeren met groene main. Geen "all-or-nothing" big-bang.

5. **Onderweg blijkt ADR-0003 op een punt fundamenteel fout (bv. bij implementeren van `Match` schema komt nieuwe inzicht).**
   *Mitigatie:* refactor pauzeren, ADR-0004 schrijven die ADR-0003 op specifiek punt amend of supersedeert, daarna spec aanpassen voordat we doorgaan. Niet stilletjes afwijken van ADR.

6. **`IdempotencyKey` shape extension breekt P05 deposits.**
   *Mitigatie:* §10 beslissing 1 = uitbreiden (niet vervangen). Bestaande `{key, scope, createdAt}` blijft ongewijzigd. Nieuwe velden zijn optioneel/nullable, dus alle bestaande inserts/queries blijven werken. Risico effectief opgelost door beslissing.

7. **`6973c1d` (Windows-determinisme test-fix) is nog nodig na refactor.**
   *Mitigatie:* commit blijft op main. De fix is op `vitest.config.ts` — generic, geen P08 dependency.

---

## 8. Rollback strategie

Per fase een tag. Als we onderweg vastlopen:

| Probleem opgetreden in | Rollback target | Commando |
|---|---|---|
| Fase 0 cleanup | pre-refactor HEAD | `git reset --hard e9fc0c5 && git tag -d refactor-fase-0` |
| Fase 1 schema | post-fase-0 | `git reset --hard refactor-fase-0` |
| Fase 2 lifecycle | post-fase-1 | `git reset --hard refactor-fase-1` |
| Fase 3 settlement | post-fase-2 | `git reset --hard refactor-fase-2` |
| etc. | | |

Voor DB:
- Na rollback: `pnpm prisma migrate reset --skip-seed` om DB-state te synchroniseren met schema na rollback.
- Migration files in `prisma/migrations/` worden gemanaged via dezelfde git rollback (gecommit per fase).

**Rollback past wanneer:**
- Fase blijkt structureel fout (niet bij eenvoudige bug — die fixen we forward).
- ADR-0003 zelf blijkt fout en behoeft ADR-0004 (zeldzaam, niet verwacht).
- Meer dan 4 uur stuk op één probleem zonder voortgang → terug naar laatste groene fase.

**Geen** rollback voor:
- Failing tests in nieuwe code (gewoon fixen).
- Typecheck errors (fixen).
- Linter klachten (fixen).

---

## 9. Geen PRD/UI in deze refactor

Deze refactor is uitsluitend backend + schema + tests. Buiten scope:
- HTTP routes onder `src/app/api/` — komen in PROMPT_16.
- UI components onder `src/components/` — komen in PROMPT_17+.
- Marketing copy, signup-flow, ToS-aanpassingen — komen na technische refactor klaar is.
- Email/notificatie integraties.
- Anti-fraud signal detectoren (`FraudSignal` etc. uit Wager) — post-MVP.

De refactor wijzigt geen bestaande HTTP routes (er zijn er nog geen voor pools — P08-09 was alleen services). Dus geen breaking change voor buitenwereld.

---

## 10. Beslissingen op open questions

1. **`IdempotencyKey` shape — UITBREIDEN.** Bestaande velden `{ key @id, scope, createdAt }` blijven ongewijzigd voor P05/P06 backward-compat. Voeg toe als optionele velden: `userId String?`, `route String?`, `statusCode Int?`, `responseJson Json?`, `completedAt DateTime?`, `expiresAt DateTime?`. Bet-routes vullen de optionele velden, deposit/withdrawal-routes gebruiken bestaande velden. Geen breaking change op P05/P06.

2. **`DisputeLog` — verdwijnt, geen `DisputeComment`.** De publieke reputation-log functionaliteit verdwijnt. ADR-0003 introduceert formele `Dispute` met deposit + admin. Reputation-impact gaat via `UserReputation` snapshots gebaseerd op resolved `Dispute`-uitkomsten (win-rate, lost-count). Geen losse public-comment laag — dat is scope creep buiten ADR-0003.

3. **Match evidence — `MatchEvidence` tabel bevestigd.** Aparte `MatchEvidence` tabel met `EvidenceType` enum (`TEXT`, `URL`, `IMAGE`, `VIDEO`), `fileUrl`, `mimeType`, `contentHash` voor dedup. Consistent met `BetEvidence` pattern. Pool creator kan meerdere evidence rows per Match toevoegen. ADR-0003 §2's vier kolom-velden direct op `Match` vervallen ten gunste van deze tabel.

4. **`creator-cannot-bet` trigger — exact SQL in PROMPT_08 spec.** PROMPT_08 specificeert de SQL: `BEFORE INSERT OR UPDATE ON bets` die failt als `bet.pool_id IS NOT NULL AND (SELECT creator_id FROM pools WHERE id = bet.pool_id) IN (bet.creator_id, bet.opponent_user_id)`. Multi-bet per (user, pool) blijft toegestaan zolang die user niet de creator van die specifieke Pool is. Test-coverage: positief pad (gewone bettor op andere creator's pool), negatief pad (pool-creator probeert eigen pool te betten als creator én als opponent).

5. **Memory file naamgeving — opruim tijdens fase 0.** Gebruiker referenceerde `~/.claude/projects/-home-rapha-zentrix/memory/feedback_wager_patterns.md` — dat bestand bestaat niet. Het Wager-rapport leeft als `reference_wager_repo.md` + `project_zentrix.md` onder `-home-rapha/memory/`. Actie tijdens fase 0: één geconsolideerd `feedback_wager_patterns.md` schrijven onder de exacte naam in het zentrix-project memory-pad zodat toekomstige sessies het rapport ondubbelzinnig vinden.

6. **Migration strategie — DROP-migration (optie ii) i.p.v. reset.** Forward-only migration history is industry standard voor production-bound projects. Optie i (`prisma migrate reset`) nukes alle dev data inclusief P05/P06 fixtures, en sluit later production migrations uit. Optie ii (DROP-migration) is veilig voor zowel dev als toekomstige prod. Sectie 3d aanbeveling en sectie 5 fase 0 zijn dienovereenkomstig aangepast.

---

## 11. Volgende stap

Na user-akkoord op dit plan:
1. Beslissingen vastgelegd in §10 (zes punten).
2. **Start fase 0** (DROP-migration + schema strip + code/docs delete + memory file write + cleanup commit + tag).
3. Bij fase 1: schrijf eerst `docs/PROMPT_08_bet_schema.md`, **stop voor review**, dan uitvoeren.

Geen uitvoering tot expliciet groen licht.
