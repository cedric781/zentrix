# HANDOFF: P18 B.0 partial → B.0 complete + B.1

**Vorige sessie eind**: 2026-05-12 ~23:00 NL
**State**: B.0 partial gecommit (b920785, gepusht), shadcn components install resterend

---

## TL;DR — start hier morgen

1. Open Codespaces vanuit `wip-p18-frontend` branch (NIET main)
2. `pnpm install` (deps al in lock)
3. `npx shadcn@latest add button card input select skeleton sonner alert badge separator`
4. Commit B.0 complete
5. Start B.1 (providers wrapper)

Estimated tijd tot B.6 PR: 3-4 uur gefocuseerd werk.

---

## Branch state
main:              ddb76c7 (P18 spec gemerged PR #12)
wip-p18-frontend:  b920785 (B.0 partial, gepusht naar origin)
1 commit ahead van main

Werk **op wip-p18-frontend branch**, niet main.

---

## Wat zit er in B.0 commit b920785

### Dependencies geïnstalleerd (klaar)

Runtime:
- `@privy-io/react-auth` ^3.23.1 (al aanwezig pre-sessie)
- `@tanstack/react-query` 5.100.10 + devtools
- `class-variance-authority` ^0.7.1
- `clsx` ^2.1.1
- `tailwind-merge` ^3.6.0
- `lucide-react` 1.14.0 (lucide bumped naar v1.x oktober 2025)
- `tw-animate-css` ^1.4.0

Dev:
- `@testing-library/react` 16.3.2
- `@testing-library/jest-dom` 6.9.1
- `@testing-library/user-event` 14.6.1
- `jsdom` 29.1.1

### Shadcn init geconfigureerd (klaar)

- `components.json` — Radix + Nova preset, neutral baseColor, lucide icons
  Aliases: `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`
- `src/lib/utils.ts` — `cn()` helper (handmatig geschreven, shadcn CLI crashte op WSL2)
- `src/app/globals.css` — Nova preset CSS vars (123 regels):
  - oklch colors light + dark
  - Sidebar variants
  - 5 chart palette colors
  - Radius scale (sm/md/lg/xl)
  - @theme inline mapping
  - tw-animate-css import

### NIET in commit (RESTEREND)

- `src/components/ui/*` — geen enkele shadcn component geïnstalleerd
  Ontbreekt: button, card, input, select, skeleton, sonner (toast), alert, badge, separator (9 stuks)

---

## Drift vs PROMPT_18 spec (gedocumenteerd, geen actie)

| Spec said | Implemented (canonical) |
|---|---|
| `style: default` | `style: radix-nova` |
| `baseColor: zinc` | `baseColor: neutral` (Nova preset default) |
| `tailwindcss-animate` | `tw-animate-css ^1.4.0` (Tailwind 4 equivalent) |
| `toast` component | `sonner` (shadcn migrated Q4 2025) |

Spec doc is historical reference. Actual implementation = source of truth.

---

## Waarom Codespaces, niet WSL

3x SIGSEGV in WSL gisteren:
1. `npx shadcn@latest init` zonder memory flag → crash bij download
2. `npx shadcn@latest init` met `NODE_OPTIONS=4096` → crash bij "Updating files"
3. `pnpm add tw-animate-css` → crash NA install (race condition, package al toegevoegd)

**Patroon**: WSL2 + V8 + Tailwind 4 + shadcn 4.7 = onbetrouwbaar voor Node-intensive operations.
**Memory entry**: `feedback_zentrix_wsl2_shadcn.md` documenteert detail.

WSL2 OK voor: cat heredoc, file edits, pnpm install (sync), vitest chunked (5-6 files), git ops.
WSL2 NIET OK voor: shadcn CLI, pnpm add met veel deps, full vitest suite, tsc large projects.

---

## Codespaces flow

### Setup (eerste keer ~5 min)

1. Browser: https://github.com/cedric781/zentrix
2. Groene "Code" knop → "Codespaces" tab
3. "Create codespace on wip-p18-frontend"
4. Wacht ~2 min op boot (Linux container met VS Code in browser)
5. Terminal opent automatisch in `/workspaces/zentrix`

### Setup (recurring sessies ~30 sec)

1. https://github.com/cedric781/zentrix → Codespaces tab
2. Bestaande codespace → "Open in browser"
3. Of "Open in VS Code Desktop" (lokaal VS Code → SSH naar codespace)

### Sync state in Codespaces

```bash
git fetch origin
git checkout wip-p18-frontend
git pull origin wip-p18-frontend
git log --oneline -3
# Verwacht: b920785 als HEAD

pnpm install
# Verwacht: "Already up to date" of snelle sync (deps in lock)
```

---

## STAP 1: B.0 complete — components install

```bash
npx shadcn@latest add button card input select skeleton sonner alert badge separator
```

**Belangrijk over `sonner` vs `toast`:**
Onze spec PROMPT_18 zei "toast" maar shadcn migrated naar `sonner` (nieuwere toast library) eind 2025. `sonner` is canonical. Pas spec doc niet aan — vermeld in commit message.

**Verwacht resultaat:**
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/sonner.tsx`
- `src/components/ui/alert.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/separator.tsx`

Extra deps mogelijk: `sonner` (npm package), `@radix-ui/react-*` voor sommige components.

**Bij conflict prompts**: kies altijd "Yes overwrite" (geen jouw werk in src/components/ui/).

### Verify components install

```bash
ls src/components/ui/
# Verwacht: 9 .tsx files

cat components.json
# Verwacht: ongewijzigd (al ingesteld)

# TypeScript check
pnpm tsc --noEmit 2>&1 | tail -20
# Verwacht: clean (geen errors)

# Vitest baseline
./node_modules/.bin/vitest run src/__tests__/http/_pagination.test.ts --no-coverage 2>&1 | tail -8
# Verwacht: 13/13 groen
```

### Commit B.0 complete

```bash
git add src/components/ui/ components.json package.json pnpm-lock.yaml

git commit -m "feat(p18): B.0 complete — shadcn components install (Codespaces)

Installed 9 shadcn components via npx shadcn@latest add in Codespaces
(WSL2 SIGSEGV blocked installation last session per HANDOFF doc):

- button, card, input, select, skeleton
- sonner (replaces 'toast' from spec — shadcn migrated to sonner Q4 2025)
- alert, badge, separator

Completes B.0 from PROMPT_18_frontend.md. Ready for B.1 (providers setup)."

git push origin wip-p18-frontend
```

---

## STAP 2: B.1 — Providers + API client

Lees eerst: `docs/PROMPT_18_frontend.md` sectie "B.1 — Providers + API client setup"

### Files te maken in B.1
NEW:

src/components/providers.tsx
PrivyProvider + QueryClientProvider wrapper
"use client"
src/lib/api/client.ts
Typed fetch wrappers per endpoint
src/lib/api/types.ts
Re-export Prisma types via serializer return types
Pattern: type BetSerialized = Awaited<ReturnType<typeof serializeBet>>

MODIFIED:

src/app/layout.tsx
Wrap children met <Providers>


### B.1 commit

```bash
git add src/components/providers.tsx src/lib/api/ src/app/layout.tsx
git commit -m "feat(p18): B.1 — providers + api client"
git push origin wip-p18-frontend
```

---

## Resterend voor P18 Phase 1 PR
B.0 complete       ← morgen eerste 30 min
B.1 providers      ← morgen ~30 min
B.2 landing+signin ← morgen ~45 min
B.3 browse feed    ← morgen ~60 min
B.4 detail page    ← morgen ~30 min
B.5 component tests ← morgen ~45 min
B.6 push + PR      ← morgen ~15 min
Totaal: ~4 uur gefocuseerd werk, P18 Phase 1 in main einde dag.

---

## Belangrijke context die memory mogelijk verliest

### Spec drifts uit eerdere fases (gedocumenteerd, geen actie)

| Wat | Spec said | Werkelijkheid (canonical) |
|---|---|---|
| Dispute field | openerId | openedById |
| Dispute outcome | ["CREATOR_WIN","OPPONENT_WIN"] | ["CREATOR_WINS","OPPONENT_WINS"] |
| Admin body | { reasoning, actorAdminId? } | { adminNotes, adminId } |
| Zod helper | ZodEnum<[string,...]> tuple | <T extends z.ZodType<string>> generic |

### Backend state (onveranderd, productie stable)

- P15 cron jobs draaien elke 5/15 min (expire-bets + cleanup-stale)
- P16 write routes in main
- P17 read routes + admin POST in main
- Geen production rollbacks gisteren
- Wager parity ~52-53%

### Auth flow voor frontend

- Cookie naam: `privy-token`
- Server: `requireCurrentUser()` / `getCurrentUser()` in `src/lib/auth.ts`
- Client: `usePrivy()` hook van `@privy-io/react-auth`
- Op `src/lib/privy/` server helpers bestaan al

### API endpoints klaar voor frontend
GET /api/bets              (cursor pagination, user-scoped)
GET /api/bets/[id]         (detail)
GET /api/disputes          (user-scoped lists)
GET /api/disputes/[id]
GET /api/pools             (cursor)
GET /api/pools/[id]
GET /api/matches/[id]
GET /api/me/balance
GET /api/me/reputation
Admin (token + isAdmin gate):
GET /api/admin/disputes
GET /api/admin/disputes/[id]
GET /api/admin/users
GET /api/admin/bets
POST /api/admin/disputes/[id]/resolve
POST /api/admin/bets/[id]/force-cancel

### Serializers voor type sharing

Locatie: `src/lib/http/serialize.ts`

Beschikbaar:
- `serializeBet`
- `serializeDispute`
- `serializeMatch`
- `serializePool`
- `serializeUser` (geen privyId, defensive default)
- `serializeUserAdmin` (met privyId + financialAccount)
- `serializeReputation`
- `serializeFinancialAccount`
- `serializePagination<T>` (generic wrapper, cursor + offset shapes)

Pattern voor frontend types:
```ts
// In src/lib/api/types.ts
import type { serializeBet } from "@/lib/http/serialize";

export type BetSerialized = Awaited<ReturnType<typeof serializeBet>>;
```

---

## Niet doen morgen (out of scope Phase 1)

- ❌ Create bet flow → P18.5 aparte fase (wallet signing complexity)
- ❌ Accept/proof/dispute UI → P19
- ❌ Admin dashboard → P20+
- ❌ Pools/matches UI → P20+
- ❌ Mobile responsive polish → P21
- ❌ Branding/design system → P22
- ❌ E2E tests (Playwright) → P22

---

## Risks / open questions voor B.1+

1. **TanStack Query v5 SSR**: dehydration in server components, niet trivial.
   Phase 1 mogelijk client-only fetching voor simplicity, SSR data in P19.

2. **Privy SDK + React 19**: peer warnings tijdens install
   (use-sync-external-store mismatch). Backward-compat in praktijk OK.
   Niet kritisch, mogelijk later upgraden naar @privy-io/node.

3. **Privy frontend SDK + ABI/wagmi peer warnings**: viem→abitype wil zod ^3,
   wij hebben zod 4.4.3. Ethereum tree, niet runtime geraakt voor Solana flow.
   Vercel CI canonical.

4. **Vitest jsdom environment**: per-file pragma `// @vitest-environment jsdom`
   op `*.test.tsx` files voor component tests. Behoudt huidige
   `fileParallelism: false` + `maxWorkers: 1` SIGSEGV-mitigations.

5. **next/dynamic for Privy?**: Privy SDK is heavy. Mogelijk dynamic import
   voor /sign-in page in B.5 als bundle size issue.

---

## Als iets fout gaat

### shadcn add crasht in Codespaces
Onwaarschijnlijk (Codespaces = stable Linux). Bij crash:
1. Check `ls src/components/ui/` → wat is al geschreven
2. Add components één-voor-één: `npx shadcn@latest add button`, dan `card`, etc
3. Bij blijvende issue: handmatig copy-paste van https://ui.shadcn.com/docs/components/<name>

### TypeScript errors na install
- `pnpm tsc --noEmit` om errors te zien
- Mogelijk: type-only mismatch zoals zod 4.x lesson uit P17
- Recovery: kleinere generic constraints in API client types

### Privy SDK version mismatch
- @privy-io/react-auth ^3.23.1 vs @privy-io/server-auth ^1.32.5
- Memory zegt deprecated warning: "Use @privy-io/node instead"
- Niet kritisch voor Phase 1, mogelijk later upgraden

### Productie verify after merge
- Vercel deployments tab → main filter → wacht Ready
- Smoke test: open productie URL
- P15 cron logs check (zou onveranderd moeten zijn)

---

## Memory entries om te raadplegen
~/.claude/projects/-home-rapha/memory/MEMORY.md (index)
~/.claude/projects/-home-rapha/memory/project_zentrix.md (huidige state)
~/.claude/projects/-home-rapha/memory/feedback_zentrix_rules.md
~/.claude/projects/-home-rapha/memory/feedback_zentrix_p15_preflight_lessons.md
~/.claude/projects/-home-rapha/memory/feedback_zentrix_zod_type_helpers.md
~/.claude/projects/-home-rapha/memory/feedback_zentrix_spec_branch_workflow.md
~/.claude/projects/-home-rapha/memory/feedback_zentrix_wsl2_shadcn.md (nieuwste)

---

## Sessie 2026-05-12 totaal
🎯 Backend 85% → 100% in productie
🎯 PR #10 P17 routes (f2d112c)
🎯 PR #11 P17 spec (fb61d1d)
🎯 PR #12 P18 spec (ddb76c7)
🎯 B.0 partial commit (b920785)
🎯 6 memory entries
🎯 Wager parity 35% → 53%
🎯 0 production rollbacks
🎯 1 zod 4.x hotfix in 1 cycle

---

**Volgende sessie**: Codespaces eerst. Stop niet midden in B-fase als energie zakt — committen op fase-grens (B.0, B.1, B.2, etc). Branch is veilig op origin.
