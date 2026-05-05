# Lessons from Wager — Niet-onderhandelbare regels

Dit document komt in `/docs/LESSONS_FROM_WAGER.md` van de nieuwe repo. Deze regels zijn afgeleid uit een directe analyse van de Wager-codebase (1286 bestanden, commit 033b861, 5 mei 2026) en de post-mortem documenten (`WITHDRAWAL_POST_MORTEM.md`, `ADVERSARIAL_CHAOS_MATRIX.md`, `DEPLOY_GAP.md`).

**Elke regel hier heeft Wager geld of tijd gekost.** Zie ze als build-time constraints, niet als suggesties.

---

## R1 — Eén Prisma schema. Punt.

**Bewijs uit Wager:** in `prisma/schema.prisma` bestaan drie complete `User`-modellen (regel 78, 333, 3124), drie `LedgerEntry`-modellen (regel 237, 485, 3479), twee `Wager`/`Bet`-modellen. De `services/api/prisma/` directory heeft daarnaast nog 10 aparte `*-additions.prisma` files. Dit is het gevolg van iteratieve refactors die nooit zijn opgeschoond.

**De regel:**
- Maximaal één `schema.prisma` in de hele repo.
- Geen `*-additions.prisma`, geen `*-v2.prisma`, geen `escrow-schema.prisma` ernaast.
- Als een model verandert: `prisma migrate dev --name <naam>` met een **schone, beschrijvende naam**. Geen suffix `_v2`, `_robust`, `_fix`, `_hardening`.
- Verboden migration-namen: alles met `robust`, `fix`, `hardening`, `v2`, `v3`, `final`, `safe`, `bulletproof`. Als die woorden nodig zijn, was de eerste versie te haastig — rollback en denk opnieuw.

**Waarom:** het Wager-schema heeft 40+ migraties waarvan minstens 8 dezelfde feature opnieuw doen (`_robust_deposit_model`, `_robust_withdrawal_model`, `_solana_migration` na een eerder EVM model, `_settlement_v2`, `_settlement_v3`). Elke parallel-versie betekent dubbele tests, dubbele bugs, dubbele debug-tijd.

---

## R2 — Eén code-tree. Geen `backend/` of `services/api/` parallel aan `src/`.

**Bewijs uit Wager:** drie complete codebases:
- `src/` — Next.js (Solana-tijdperk)
- `backend/` — aparte Node service (EVM-tijdperk, deels nog actief)
- `services/api/` — derde codebase (EVM-tijdperk, status onduidelijk)

In elk van deze trees bestaat een eigen `LedgerService`, eigen tests, eigen Prisma client. Ze zijn ooit gemaakt om "schaalbaar" te zijn. Resultaat: bij elke verandering moest in 2-3 plekken gedacht worden, en de pivot van EVM naar Solana liet `backend/` en `services/api/` half-dood achter.

**De regel:**
- Eén Next.js app. Alle server-code in `src/lib/` en `src/app/api/`.
- Geen aparte Node-service voor de eerste 6 maanden. Crons via Vercel Cron Jobs of Inngest.
- Pas opsplitsen als je >50.000 actieve gebruikers hebt of een heel duidelijke latency/cost reden. "Misschien later" is geen reden.

**Waarom:** Vercel + Next.js + Prisma + Inngest dekt 100% van wat Wager nu doet en is één deploy. Een tweede tree introduceert: tweede `package.json`, tweede `tsconfig.json`, tweede CI-pipeline, twee versies van shared types die uit sync raken.

---

## R3 — Maximaal 5 actieve debug-scripts in `/scripts/`.

**Bewijs uit Wager:** `/scripts/` bevat 53 unieke debug-scripts: `check-ledger-state`, `diagnose-ledger-drift`, `fix-ledger-drift`, `repair-financial-corruption`, `quarantine-phantom-accounts`, `restore-reporter-balance`, `trace-affected-user-v2`, `verify-85e15a88` (genoemd naar één bug-ID!), enz.

**Elk debug-script is bewijs dat de observability-laag iets niet liet zien dat het wél had moeten zien.**

**De regel:**
- Maximaal 5 actieve scripts in `/scripts/`. Punt.
- Boven die limiet: één van de scripts moet een **dashboard-metric of alert** worden in de productie-app. Pas dán mag het script weg of bewaard in `/scripts/archive/` (read-only).
- Verboden script-namen: alles met `fix-`, `repair-`, `restore-`, `quarantine-`, of een hex-hash erin. Als je die schrijft, schrijf eerst de metric.

**Waarom:** een fix-script lost één incident op. Een metric voorkomt het volgende incident. Wager heeft de metric overgeslagen en kreeg er incident #2, #3, #4 bij — vandaar 53 scripts.

---

## R4 — Money paths zijn BigInt. Altijd.

**Bewijs uit Wager:** dit ging Wager *goed*. Alle money paths in `src/lib/ledger/` gebruiken BigInt (`amountUnits: BigInt`), de fee-berekening gebruikt integer-divisie met floor (`floor(pot * bps / 10000)`), conservatie-invariant `potUnits = winnerPayout + feeUnits` is exact.

**De regel:**
- Geen `number` in money paths. Niet voor amounts, niet voor balances, niet voor fees.
- USDC heeft 6 decimalen → micro-units in BigInt (`1 USDC = 1_000_000n`).
- Aparte module `src/lib/money/units.ts` met `parseUsdc`, `formatUsdc`, `applyBps`, `unitsToNumber`. Niemand schrijft inline `* 1000000`.
- Tests: minstens één test per money-pad die controleert dat input-output exact balanceert (totalDebits === totalCredits).

**Waarom:** float in money is een tijdbom. BigInt is zwaarder maar deterministisch — en JS heeft geen Decimal natively. Wager bewees dat dit werkt. Houden.

---

## R5 — Idempotency keys op DB-niveau. Geen application-level "checks".

**Bewijs uit Wager:** elke money-movement gaat door `recordTransaction()` met een `idempotencyKey` veld dat `@unique` is op de DB. Voorbeelden uit Wager's `engine.ts`:
- `deposit:${txHash}:${logIndex}` — idempotent op deposit
- `bet-hold:${betId}:${role}` — idempotent op stake hold
- `settle:${betId}` — idempotent op settlement
- `withdrawal:${withdrawalId}` — idempotent op uitbetaling

**De regel:**
- Elke money-movement heeft een `idempotencyKey: string` argument. Geen defaults, geen "intern genereren". Caller bepaalt.
- De `LedgerTransaction.idempotencyKey` kolom heeft `@unique` constraint. DB rejected duplicates, code hoeft niet te checken.
- Geen "check-then-act" patroon: nooit eerst SELECT om te zien of het al bestaat, dan INSERT. Dat is een race condition. INSERT met UNIQUE constraint en vang `P2002` af.

**Waarom:** webhooks komen dubbel binnen. Crons overlappen. Stale workers re-attempt. Zonder DB-level uniqueness lekt geld via dubbele credits. Wager's chaos matrix bewijst dat dit patroon collision-safe is bij 10 mixed triggers in 200ms.

---

## R6 — FOR UPDATE op account-rows tijdens money-movements.

**Bewijs uit Wager:** `src/lib/ledger/accounts.ts` heeft een `lockAccount(tx, accountId)` functie die `SELECT ... FOR UPDATE` doet. Elke money-movement die balance-checks doet, lockt eerst. De Adversarial Chaos Matrix bewijst dat dit + version guards + idempotency keys = exactly-once execution.

**De regel:**
- Money-movement = altijd binnen een Prisma `$transaction()`.
- Voor balance-check: eerst `lockAccount(tx, accountId)` met FOR UPDATE.
- Voor wager state changes: optimistic lock met `version` veld + `WHERE version = X` in update.
- Als deze twee patronen niet aanwezig zijn in een money-pad: **de PR mag niet gemerged**.

**Waarom:** zonder FOR UPDATE kan twee parallel worker dezelfde balance lezen, beide debiteren, en je hebt een negatief saldo. Postgres FOR UPDATE serialiseert per row — exact wat we willen.

---

## R7 — Validatie op de intake-grens, niet pas bij de executor.

**Bewijs uit Wager:** uit `WITHDRAWAL_POST_MORTEM.md`:
> *"A withdrawal request reached the executor with a destination address containing a non-base58 character. The executor's `new PublicKey(withdrawal.toAddress)` call threw, the row transitioned to FAILED, and a compensating ledger transaction was recorded."*

De fix: **dezelfde** `new PublicKey()` call op de intake API doen. Als die throwt → 400 INVALID_ADDRESS. Geen ledger-transaction nodig, geen reversal nodig.

**De regel:**
- Elke user-input die een externe call zal doen (Solana address, amount, signature) wordt **gevalideerd op de intake-route** met **exact dezelfde call** als de executor.
- Validatie via Zod schema is goed voor formaat, niet voor semantiek. `z.string()` keurt `0OIl` goed — Solana niet.
- Voorbeeld: `parseSolanaAddress(input)` is een eigen helper die `new PublicKey(input)` doet en bij failure een typed error gooit. Gebruik die overal.

**Waarom:** een rejection bij intake = HTTP 400, geen DB-row, geen ledger-entry, geen reversal. Een rejection bij executor = DB-row met FAILED status, ledger debit, reversal credit, monitoring-alert. 50× meer werk voor dezelfde fout.

---

## R8 — Env-management: één bron, hardcoded fallbacks toegestaan voor kill-switches.

**Bewijs uit Wager:** uit `DEPLOY_GAP.md`:
> *"Vercel env-store bug (support ticket 01142477) blocks clean production deploys. Mission commits 3-6 are shipping to Preview only."*

De fix: hardcoded kill-switch in code (`src/lib/withdrawals/kill-switch-hardcode.ts`) als workaround. Werkte, maar is anti-pattern in normaal beheer.

**De regel:**
- Productie-config in **één** env-store (Vercel env). Geen `.env.production.local` als bron, alleen als emergency-restore vanuit password manager.
- Verplichte env-vars worden gevalideerd bij app-startup met Zod schema. App weigert te starten als er één mist. Géén "ah het is undefined, fallback".
- Kill-switches mogen hardcoded in code als de env-store stuk is — maar elke hardcoded kill-switch krijgt direct een GitHub issue met label `tech-debt-env-store` en moet binnen 30 dagen weg.
- Geen kill-switches voor business-logic dingen ("disable feature X" via env). Alleen voor **veiligheid** (`WITHDRAWALS_DISABLED`, `DEPOSITS_DISABLED`).

**Waarom:** env-management dat niet kan worden gedeployed = een kapot deploy-proces. Een hardcoded kill-switch is de minste van twee kwaden bij een platform-bug, maar mag nooit standaard worden.

---

## R9 — Geen feature is af zonder een metric en een alert.

**Bewijs uit Wager:** Wager heeft `monitoring/alerts.ts` en `monitoring/metrics.ts`, maar pas in fase 4 toegevoegd. De 53 debug-scripts zijn de schade van die vertraging.

**De regel:**
- Een PR voor een feature die geld raakt, moet bevatten:
  1. De feature-code
  2. Minstens 1 unit test voor de happy path
  3. Minstens 1 unit test voor het belangrijkste failure-pad
  4. **Eén metric** (counter of gauge) die productie-gedrag waarneembaar maakt
  5. **Eén alert-conditie** (zelfs als die nog niet aan een channel hangt — schrijf de SQL of de code)
- Definitie van "klaar": ik kan in 30 seconden zien hoeveel keer dit feature uitgevoerd is en hoeveel keer het faalde.

**Waarom:** zonder metric weet je niet of je feature in productie überhaupt loopt. Zonder alert kom je er pas achter via klanten. Wager's eerste failed withdrawal werd ontdekt via een handmatige database-scan — niet acceptabel voor een platform met geld.

---

## R10 — Test-bestanden hebben rechten, geen plichten.

**Bewijs uit Wager:** `__tests__/` directories met goede coverage op de critical paths (`wallet-safety.test.ts` 16 redactions, `address-validation.test.ts` 14, `withdrawal-security.test.ts` 9, `engine.stranded-funds.test.ts` 9). Dit deel werkte.

**De regel:**
- `src/__tests__/financial/concurrency-chaos.test.ts` (of equivalent): één test die parallel 10 conflicting calls doet en bewijst dat exactly-once geldt.
- `src/__tests__/financial/ledger-integrity.test.ts`: één test die voor een willekeurige set transactions bewijst dat `SUM(debits) === SUM(credits)` per transaction.
- `src/__tests__/financial/balance-invariants.test.ts`: één test die bewijst dat een user balance bij elke step gelijk is aan `SUM(credit_entries) - SUM(debit_entries)` over tijd.
- Deze drie tests draaien in CI op elke PR. Ze zijn niet optioneel.

**Waarom:** dit zijn de drie invariants die als ze breken, geld lekken. Bovendien helpen ze om het systeem zelf-bewijzend te maken — geen 53 scripts die SQL queries doen om te checken of het klopt, want de tests doen dat al.

---

## R11 — Geen smart contract tot het bewezen nodig is.

**Bewijs uit Wager:** drie smart contracts (`WagerEscrow.sol`, `_V2.sol`, `_V3.sol`), drie deployment-scripts (`deploy-escrow.ts`, `deploy-v2.ts`, `deploy-v3.ts`, `deploy-v3-hardened.ts`), backups (`flattened.sol`, `flattened_v2.sol`, `flattened_clean.sol`), `types/ethers-contracts/factories/` met drie factories. **Alle dood spoor** na de pivot naar Solana.

**De regel:**
- Eerste 3 maanden: **geen smart contract**. Geld in/uit gaat via embedded wallets (Privy) + server-controlled transfers + double-entry ledger als source of truth.
- Een smart contract komt pas in beeld als:
  1. Je een concrete trust-issue hebt die alleen een contract oplost (bv. publieke verifiability voor een specifieke regulator)
  2. Je een audit-budget hebt (≥ €15k voor een serieuze audit)
  3. Je upgrade-pad ontworpen hebt **vóór** je deployed

**Waarom:** Wager heeft maanden besteed aan WagerEscrow V1/V2/V3, een gnosis-safe multisig treasury, een trusted relayer — om vervolgens naar Solana te gaan en de hele on-chain settlement weer als ledger-only te doen. Het smart contract werk was netto verlies.

---

## R12 — Documenteer "wat ik niet ga doen" net zo hard als "wat ik wel ga doen".

**Bewijs uit Wager:** `AUDIT_SCOPE.md`, `WITHDRAWAL_FRAMEWORK_AUDIT.md`, `WITHDRAWAL_AUDIT_CORRECTION.md`. **Deze documenten zijn goud.** Ze leggen vast wat in scope was, wat expliciet niet, en waarom.

**De regel:**
- Elke ADR heeft een `## Rejected alternatives` sectie. Niet één regel — minstens drie zinnen per alternatief, met de reden.
- Elke PR die een module aanraakt heeft in de description: "Niet in scope: <X, Y, Z>" — om scope creep zichtbaar te maken.
- "Out of scope" is een feature, niet een fout.

**Waarom:** zonder dit ga je over 3 maanden twijfelen waarom je iets gekozen hebt, en herstart je het ontwerp. Wager heeft dit een paar keer gedaan (zie de drie generaties User-modellen).

---

## Samenvatting — de 12 regels in één tabel

| # | Regel | Wager-bewijs | Symptoom als je het breekt |
|---|-------|--------------|----------------------------|
| R1 | Eén Prisma schema | 3× User, 3× LedgerEntry | Dubbele migraties, fragiele refactors |
| R2 | Eén code-tree | `src/` + `backend/` + `services/api/` | Half-dode legacy, sync-bugs |
| R3 | Max 5 debug-scripts | 53 scripts in `/scripts/` | Geen observability, blinde productie |
| R4 | Money = BigInt | (was goed in Wager) | Float drift, geld verdwijnt |
| R5 | Idempotency op DB | (was goed in Wager) | Dubbele credits via webhooks |
| R6 | FOR UPDATE op account rows | (was goed in Wager) | Race conditions, negatieve saldi |
| R7 | Validatie op intake | Withdrawal post-mortem | Failed rows met dangling state |
| R8 | Eén env-store | Vercel bug ticket 01142477 | Deploys lopen vast |
| R9 | Metric + alert per feature | 53 fix-scripts | Bugs zichtbaar via klanten |
| R10 | 3 invariant-tests in CI | (gedeeltelijk goed) | Geld lekt onopgemerkt |
| R11 | Geen smart contract upfront | 3× WagerEscrow, dood na pivot | Maanden weggegooid werk |
| R12 | Document wat niet gedaan wordt | (was goed in audits) | Scope creep, refactor-cyclus |

**Bij elke PR: lees deze tabel.** Bij twijfel: regel die je breekt benoemen en uitleggen waarom de uitzondering nodig is. Geen uitleg = geen merge.
