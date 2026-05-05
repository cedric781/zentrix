# Zentrix — Pakket voor schone herstart

Dit pakket bevat alles om een nieuw wagering-platform op te zetten dat de **goede patronen** van Wager hergebruikt zonder de **architectuur-fouten** te herhalen.

## Wat zit erin (8 bestanden)

| # | Bestand | Doel |
|---|---------|------|
| 00 | `00_README.md` | Dit bestand — leesvolgorde |
| L | `LESSONS_FROM_WAGER.md` | Niet-onderhandelbare regels uit de Wager-postmortem. Lees als eerste. |
| A | `ADR-0001-architecture.md` | Architectuur-keuzes vastgelegd. Lees als tweede. |
| P2 | `PHASE_2_PREVIEW.md` | Vooruitblik op Event/Pool/Organization scope (fase 2). Lees als derde. **Geen prompt om uit te voeren.** |
| 1 | `PROMPT_01_init_repo.md` | Init monorepo: Next.js + Prisma + Privy + structure |
| 2 | `PROMPT_02_prisma_schema.md` | Eén Prisma schema, gebaseerd op canonieke modellen uit Wager |
| 3 | `PROMPT_03_auth_privy.md` | Privy auth + embedded wallet provisioning |
| 4 | `PROMPT_04_ledger.md` | Double-entry ledger (geport uit `src/lib/ledger/` van Wager) |
| 5 | `PROMPT_05_deposits.md` | Deposit pipeline: Helius webhook + poller fallback |
| 6 | `PROMPT_06_withdrawals.md` | Withdrawal intake + executor met **address-validatie vooraf** (de fix uit de post-mortem) |
| 7 | `PROMPT_07_observability.md` | Metrics + alerts + recon engine — zodat je géén 53 debug-scripts hoeft te schrijven |

## Leesvolgorde — strikt aanhouden

1. **Lees eerst `LESSONS_FROM_WAGER.md`.** Dit zijn de regels. Als je ze breekt herhaal je de Wager-fouten.
2. **Lees daarna `ADR-0001-architecture.md`.** De keuzes liggen vast. Als je ze later wilt veranderen, eerst dit document updaten met datum + reden.
3. **Lees dan `PHASE_2_PREVIEW.md`.** Dit beschrijft het Event/Pool/Organization framework dat in fase 2 erbij komt. Niet uitvoeren — alleen lezen, zodat je tijdens fase 1 niets bouwt dat fase 2 blokkeert.
4. **Voer dan de prompts 01 t/m 07 uit, in volgorde.** Niet door elkaar. Elke prompt heeft:
   - **Pre-flight grep** — verificatie dat de vorige stappen correct zijn
   - **De prompt zelf** — kopieer naar Claude Code
   - **Post-flight grep** — verificatie dat het werkt voordat je commit
   - **Wat dit niet doet** — duidelijk wat je niet moet verwachten

## Hoe te gebruiken met Claude Code

Voor elke prompt:

```
1. cd ~/zentrix        # of waar je nieuwe repo staat
2. git status             # moet schoon zijn (geen uncommitted changes)
3. Run de pre-flight greps uit het prompt-bestand
4. Open Claude Code
5. Paste de prompt (alles tussen ── BEGIN PROMPT ── en ── END PROMPT ──)
6. Wacht tot Claude Code klaar is
7. Run de post-flight greps
8. Run npm test (vanaf prompt 04)
9. git add -A && git commit -m "<exact bericht uit prompt>"
10. Door naar volgende prompt
```

## Belangrijk — eerlijk over wat dit pakket niet is

**Wat dit pakket niet is:**
- Geen instant-werkend product. Na alle 7 prompts heb je een **fundament**, geen feature-compleet platform.
- Geen vervanging voor Wager's bedrijfslogica voor disputes, arbiters, oracles, side-bets, fraud signals. Die komen in fase 2 en 3.
- Geen vervanging voor jouw oordeel. Bij elke prompt staat duidelijk wat je moet checken.

**Wat dit pakket wel is:**
- Een fundament dat de 4 hoofdfouten van Wager structureel voorkomt (één schema, één deploy, één env-store strategie, observability vóór features).
- Een ladder die je in ~3 weken naar een werkende, deploybare basis brengt.
- Code die voor 90% komt uit Wager's productie-bewezen modules — geport, niet herschreven.

## Volgorde van bouwen — fasen

| Fase | Tijd | Inhoud | Eindstaat |
|------|------|--------|-----------|
| **Fase 1: Fundament** | week 1-2 | Prompts 01-07 (dit pakket) | Login werkt, geld storten/zien/opnemen werkt. Géén pools nog. |
| **Fase 2: Event/Pool/Organization** | week 3-5 | Volgend pakket — zie `PHASE_2_PREVIEW.md` voor de scope | Organization kan event maken, users kunnen joinen, auto-payout naar winnaars. |
| **Fase 3: Compliance + hardening** | week 6+ | KYC hooks, age verification, geo restrictions, dispute UI, adversarial chaos matrix patterns | Klaar voor licentie-aanvraag in een gereguleerde markt. |

Vraag mij om het volgende pakket zodra fase 1 deploybaar is en getest op een echte Vercel-URL (niet alleen lokaal!).
