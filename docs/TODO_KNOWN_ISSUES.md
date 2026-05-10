# Known Issues — Zentrix

## Auth (uit PROMPT_03)

### 1. Multiple pnpm-lock.yaml workspace warning
- C:\Users\rapha\pnpm-lock.yaml bestaat (van ander oud project)
- Turbopack pakt dat als project root
- FIX VOOR PROMPT_05: zet turbopack.root: __dirname in next.config.ts
- Of: verwijder C:\Users\rapha\pnpm-lock.yaml (controleer eerst of
  geen oud project ervan afhankelijk is)

## PROMPT_09 leftover items

- POOL_NOT_FOUND not directly tested for createPool/publishPool/closePool
  (only cancelPool) — implicit via existence checks but no explicit test.
  createPool takes no poolId (N/A); publishPool/closePool covered implicitly.
  Low risk for MVP — schema FK + service guards both block it.
- Helper duplicatie tussen pool-escrow-invariant.test.ts en
  pool-lifecycle.test.ts (makeUser, SUFFIX, PRIVY_PREFIX patroon) — extract
  naar src/__tests__/pools/_helpers.ts in PROMPT_10 wanneer 3+ test files
  dezelfde helpers nodig hebben.
- cancelPool with bets edge case (OPEN/CLOSED with placed bets) deferred to
  PROMPT_15 cancelPoolWithRefund (per-entry BET_REFUND ledger entries +
  escrow drain + status → REFUNDED).
- closePool 'by' parameter not persisted — audit-log column deferred to
  PROMPT_14 (DisputeLog/AuditLog table).

## PROMPT_13 tech debt

### Migrate dispute evidence naar dedicated `DisputeEvidence` table V2
- **Huidige staat (MVP):** dispute-fase evidence wordt opgeslagen in
  `BetEvidence` met description-prefix `[dispute:${disputeId}] `. Read-paden
  in `resolveDispute` filteren via `description.startsWith(...)`. Dedup via
  schema's bestaande `@@unique([betId, contentHash])`.
- **Probleem op termijn:** (a) prefix-conventie is fragiel — als iemand de
  prefix vergeet of misformateert raken evidence rows "onzichtbaar" voor
  dispute-pad. (b) Bij grote bet-evidence sets (post-launch met veel proof-
  items pre-dispute) wordt `LIKE '[dispute:%' OR description LIKE ...`
  filter een tablescan. (c) Geen onderscheid tussen pre-dispute proof en
  dispute-fase evidence in admin UI behalve via prefix-parsing.
- **Migratie target:** dedicated `DisputeEvidence` tabel met `disputeId`,
  `uploadedById`, `type` (EvidenceType), `fileUrl?`, `mimeType?`,
  `contentHash`, `description?`, `createdAt`, plus `@@unique([disputeId,
  contentHash])` dedup en index `[uploadedById, createdAt]`. Migration
  kopieert bestaande prefixed `BetEvidence` rows (parses prefix → disputeId,
  strips prefix from description), markeert oorspronkelijke rows als
  archief of laat ze leeg-prefix achter.
- **Trigger:** komt in PROMPT_18+ (post-MVP cleanup) zodra (a) prefix-
  conventie operationeel pijn doet, of (b) productfeature dispute-evidence
  apart wil tonen. Niet urgent voor MVP launch — pad werkt correct.
- **Geregistreerd door:** PROMPT_13 spec §6, Q4 resolutie 2026-05-10.
