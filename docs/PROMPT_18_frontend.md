# P18: Frontend MVP — auth + landing + browse bets

## Doel

Phase 1 frontend voor Zentrix. Drie user flows: Privy login, landing page (logged-in vs logged-out), browse bets feed. Functioneel first (shadcn defaults). Geen create-bet, geen dispute UI, geen admin UI in deze fase.

## Builds on

- **P07–P17 backend** — alle endpoints in production (main HEAD `fb61d1d`).
- **`src/lib/auth.ts`** — `requireCurrentUser` / `getCurrentUser` (Privy cookie session via `privy-token` cookie).
- **`src/lib/privy/server.ts`** — `getPrivyServerClient` voor token verification.
- **`GET /api/bets`** — cursor pagination, user-scoped read service (P17 `listBets`).
- **`GET /api/me/balance` + `GET /api/me/reputation`** — voor header balance + dashboard preview.
- **`src/lib/http/serialize.ts`** — `serializeBet`, `serializeUser`, `serializeFinancialAccount`, `serializeReputation` voor type-sharing client ↔ backend.
- **`src/lib/http/pagination.ts`** — cursor envelope (decoder is server-side, client behandelt cursor als opaque string).

## Scope

### In (Phase 1)

- Privy embedded auth flow (login modal, session bootstrapping via `@privy-io/react-auth`).
- Landing page: logged-out (CTA naar `/sign-in`) + logged-in (dashboard preview met balance/reputation).
- Browse bets feed (`/bets`): cursor pagination, status filter, mijn-bets context (user-scoped via `/api/bets`).
- Bet detail page (`/bets/[id]`): read-only (status, stake, opponent, expires).
- Header met user balance + logout.
- shadcn/ui setup: `button`, `card`, `input`, `select`, `skeleton`, `toast`, `alert`, `badge`, `separator`.
- TanStack Query v5 setup met `QueryClient` provider.
- Type sharing met backend via `src/lib/api/types.ts` (re-export serializer return types).
- Vitest + `@testing-library/react` voor component tests.
- Loading states + error states overal (per-page `loading.tsx` + `error.tsx`).

### Out of scope (P18.5+ / P19+)

- Create bet flow (P18.5 — aparte fase: wallet signing, idempotency UX).
- Accept bet flow (P19).
- Submit proof / confirm result (P19).
- Dispute UI (P19).
- Admin dashboard (P20+).
- Pools/matches UI (P20+).
- Wallet deposit/withdraw flows.
- Mobile-responsive polish (P21+).
- Branding / custom design system (P21+).
- E2E tests (Playwright, P22+).
- i18n / locale (post-MVP).
- Dark mode toggle (shadcn default = dark, polish later).
- SEO meta tags (post-MVP).

## Pre-flight

- `git status` clean op main `fb61d1d`.
- `pnpm --version` werkt.
- `NEXT_PUBLIC_PRIVY_APP_ID` + Privy server secret in `.env` (backend gebruikt deze al).
- Backend draait lokaal op `localhost:3000` of via staging URL (frontend gebruikt zelfde origin → geen CORS).
- `npx shadcn-ui` CLI beschikbaar (auto via npx, geen install nodig).
- Branch: `wip-p18-frontend` vanaf main `fb61d1d` (niet stacked).

## Design Decisions (locked)

### 1. App router structure

```
src/app/
├── layout.tsx              (RootLayout + Providers wrapper)
├── page.tsx                (landing — server component, conditional render)
├── error.tsx               (global error boundary)
├── (auth)/
│   └── sign-in/page.tsx    (Privy login UI, client component)
├── bets/
│   ├── page.tsx            (browse feed, client component voor filters)
│   ├── loading.tsx         (skeleton)
│   └── [id]/
│       ├── page.tsx        (detail, server component met initial fetch)
│       └── loading.tsx
└── api/                    (BACKEND BESTAAT AL — niet aanraken in P18)
```

### 2. Server vs Client components

- **Server components default**: layouts, page shells, initial data fetches via direct service-call (server-side `getCurrentUser()` → `listBets(...)` → pass to client component).
- **Client components**: forms, filters, interactive UI; gemarkeerd met `"use client"`.
- **Server actions**: NIET gebruikt in Phase 1. TanStack Query mutations gaan via fetch naar bestaande API routes.

### 3. Auth flow — Privy provider setup

- `@privy-io/react-auth` `PrivyProvider` in `src/components/providers.tsx` (client component).
- Config: `appId` (uit `NEXT_PUBLIC_PRIVY_APP_ID`), `loginMethods: ["email", "google"]`, `embeddedWallets: { createOnLogin: "users-without-wallets", chainType: "solana" }`.
- Session bootstrap: `usePrivy()` hook → `user.id` → TanStack Query fetch `/api/me/balance` + `/api/me/reputation`.
- Logout: `privy.logout()` + clear `privy-token` cookie + `router.push("/")`.
- **Cookie naam**: backend leest `privy-token` cookie (zie `src/lib/auth.ts:20`). Privy frontend SDK schrijft die cookie automatisch op succesvolle login — geen extra werk in P18.

### 4. Route guards

- **Server-side**: `page.tsx` checkt via `await getCurrentUser()` — null → `redirect("/sign-in")`. Dit is de canonical guard voor protected pages.
- **Client-side**: `useAuthGuard()` hook in interactive components — wrapper voor `useRouter().push("/sign-in")` als `usePrivy().authenticated === false`.
- **Geen middleware.ts** in Phase 1 (overkill voor 3 protected pages, mogelijk in P19 als route-count groeit).

### 5. Data fetching — TanStack Query setup

- `QueryClient` in `providers.tsx` met defaults: `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`, `gcTime: 5 * 60_000`.
- **Query keys conventie**: `["bets", "list", { userId, status, cursor }]` / `["bets", "detail", id]` / `["me", "balance"]` / `["me", "reputation"]`.
- **Mutations**: `useMutation` met `onSuccess` invalidatie van relevante query keys. (Phase 1 heeft geen mutations actief, infra wel klaar voor P18.5.)
- **Optimistic updates**: NIET in Phase 1 (alleen reads).
- **SSR/dehydration**: NIET in Phase 1 — client-only fetching voor simplicity. Server components mogen direct data passen via props naar client components als "initial data" zonder query-hydration. SSR-hydration komt P19.

### 6. API client + type sharing

- `src/lib/api/client.ts`: typed fetch wrappers per endpoint (`listBets`, `getBet`, `getMeBalance`, `getMeReputation`).
- `src/lib/api/types.ts`: re-export serializer return types.

```ts
import type { serializeBet, serializeFinancialAccount } from "@/lib/http/serialize";
export type BetSerialized = ReturnType<typeof serializeBet>;
export type BalanceSerialized = ReturnType<typeof serializeFinancialAccount>;
```

- **Geen runtime validation in client** (backend zod is canonical, client trusts backend response shape).
- **Fetch wrappers** map non-2xx naar typed errors (`ApiError({ status, code, issues? })`) zodat TanStack Query `onError` consistent kan reageren.

### 7. shadcn/ui setup

- `npx shadcn-ui init` — theme: default, base color: zinc, CSS vars: yes, RSC: yes.
- Components installed (Phase 1): `button`, `card`, `input`, `select`, `skeleton`, `toast`, `alert`, `badge`, `separator`.
- Theme file: `src/app/globals.css` (CSS vars auto-gegenereerd door CLI).
- Components dir: `src/components/ui/` (auto-gegenereerd, vendored — onderdeel van jouw repo, niet runtime dependency).
- `components.json` config in repo root.

### 8. Loading + error states

- **Loading**: per page een `loading.tsx` file met `<Skeleton />` components (browser krijgt instant feedback tijdens server-component render).
- **Error**: per page een `error.tsx`, plus globale `src/app/error.tsx` als fallback. Beide client components met `reset()` button.
- **TanStack Query**: `isPending` + `isError` handling per component die `useQuery` aanroept.
- **Toast notifications**: `useToast()` (shadcn) voor mutation feedback. Phase 1 heeft geen mutations actief, infra wel klaar.

### 9. Image + asset strategy

- `next/image` voor toekomstige user avatars (Phase 1: geen avatars, alleen tekst/initials).
- `public/` voor logo + favicon (placeholder voor nu, branding komt P21+).
- Geen `images.domains` config in Phase 1.

### 10. Test strategy

- **Component tests**: Vitest + `@testing-library/react` + `@testing-library/user-event`.
- **Mock Privy**: `vi.mock("@privy-io/react-auth")` met `usePrivy` stub.
- **Mock TanStack Query**: test-utility `renderWithQueryClient(ui)` met fresh `QueryClient` (`{ defaultOptions: { queries: { retry: false } } }`).
- **Mock API client**: `vi.mock("@/lib/api/client")`.
- ~15-20 tests Phase 1 (rendering, loading-state, error-state, filter-interaction, pagination-click).
- **GEEN E2E tests** in Phase 1 (Playwright komt P22+).

## Files touched

### NEW — config + setup

- `package.json` — add deps: `@privy-io/react-auth`, `@tanstack/react-query`, `@tanstack/react-query-devtools`, shadcn peer deps (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss-animate`, Radix primitives per component). Dev deps: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`.
- `components.json` — shadcn config (NEW).
- `src/app/globals.css` — shadcn CSS vars + Tailwind imports (NEW of EXTEND).
- `src/app/layout.tsx` — wrap children met `<Providers>` (EXTEND).
- `src/components/providers.tsx` — `PrivyProvider` + `QueryClientProvider` + `Toaster` wrapper (NEW).
- `src/lib/api/client.ts` — fetch wrappers + `ApiError` class (NEW).
- `src/lib/api/types.ts` — re-exports voor serializer types (NEW).
- `src/lib/auth/use-auth-guard.ts` — client-side guard hook (NEW).
- `src/lib/test/render.tsx` — `renderWithQueryClient` test utility (NEW).

### NEW — pages

- `src/app/page.tsx` — landing (server component met `getCurrentUser()` branching).
- `src/app/(auth)/sign-in/page.tsx` — Privy login UI (client component).
- `src/app/bets/page.tsx` — browse feed shell (client component voor filters).
- `src/app/bets/[id]/page.tsx` — detail (server component, initial fetch via service).
- `src/app/bets/loading.tsx` — skeleton.
- `src/app/bets/[id]/loading.tsx` — skeleton.
- `src/app/error.tsx` — global error boundary.

### NEW — components

- `src/components/site-header.tsx` — logo + balance display + logout (client component).
- `src/components/bet-list.tsx` — `useQuery` + cursor pagination (client component).
- `src/components/bet-card.tsx` — single bet row (server-safe presentational).
- `src/components/bet-filters.tsx` — status select + search (client component).
- `src/components/status-badge.tsx` — colored badge per `BetStatus`.
- `src/components/ui/*` — shadcn auto-generated (vendored).

### NEW — tests

- `src/__tests__/components/bet-card.test.tsx`
- `src/__tests__/components/bet-list.test.tsx`
- `src/__tests__/components/bet-filters.test.tsx`
- `src/__tests__/lib/api-client.test.ts`

## Fasering (commits)

### B.0 — Dependencies + shadcn init

- `pnpm add @privy-io/react-auth @tanstack/react-query @tanstack/react-query-devtools`
- `pnpm add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`
- `npx shadcn-ui init` (handmatige stap, output: `components.json` + `src/app/globals.css` update).
- `npx shadcn-ui add button card input select skeleton toast alert badge separator`.
- Vitest config update voor jsdom env op `*.test.tsx`.
- Commit: `feat(p18): B.0 — dependencies + shadcn/ui init`.

### B.1 — Providers + API client setup

- `src/components/providers.tsx` (PrivyProvider + QueryClientProvider + Toaster).
- `src/lib/api/client.ts` + `src/lib/api/types.ts`.
- `src/lib/auth/use-auth-guard.ts`.
- `src/lib/test/render.tsx` test utility.
- `src/app/layout.tsx` update om Providers te wrappen.
- 1 test file: `src/__tests__/lib/api-client.test.ts` (~4 tests: happy 200, 401 → ApiError, 400 → ApiError met issues, network fail).
- Commit: `feat(p18): B.1 — providers + api client`.

### B.2 — Landing + sign-in

- `src/app/page.tsx` (server component, `getCurrentUser()` branching).
- `src/app/(auth)/sign-in/page.tsx` (client component met Privy login button).
- `src/components/site-header.tsx`.
- `src/app/error.tsx`.
- Geen tests in deze fase (UI is grotendeels presentational; full coverage in B.5).
- Commit: `feat(p18): B.2 — landing + sign-in`.

### B.3 — Browse bets feed

- `src/app/bets/page.tsx` (client shell met filters state).
- `src/components/bet-list.tsx` + `bet-card.tsx` + `bet-filters.tsx` + `status-badge.tsx`.
- `src/app/bets/loading.tsx`.
- Commit: `feat(p18): B.3 — browse bets feed`.

### B.4 — Bet detail page

- `src/app/bets/[id]/page.tsx` (server component, `getBet({ id, userId })` via direct service-call, geen fetch).
- `src/app/bets/[id]/loading.tsx`.
- Commit: `feat(p18): B.4 — bet detail page`.

### B.5 — Component tests

- 3 component test files (~12-15 tests):
  - `bet-card.test.tsx` — render status, stake formatting, expires display, 3-4 tests.
  - `bet-list.test.tsx` — loading state, error state, items render, "load more" click, 4-5 tests.
  - `bet-filters.test.tsx` — status change triggers callback, search input debounce, reset behavior, 3-4 tests.
- Commit: `feat(p18): B.5 — component tests`.

### B.6 — Verify + push + PR

- `pnpm test` — alle nieuwe + bestaande tests groen (baseline 245 + ~15-20 nieuw ≈ ~265).
- `pnpm build` — lokaal best-effort; **Vercel CI canonical** per [[feedback_zentrix_p15_preflight_lessons]].
- Pre-flight grep: pino-signature check op alle nieuwe files (geen call-site overgeslagen, P15 regression-class).
- Push `wip-p18-frontend` → remote.
- PR draft. **NIET mergen tot Vercel CI groen.**

## Test pattern reference (BetCard)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BetCard } from "@/components/bet-card";
import type { BetSerialized } from "@/lib/api/types";

const mockBet: BetSerialized = {
  id: "bet-1",
  status: "OPEN",
  stakeUnits: "1000000",          // 1 USDC in micro-units
  createdById: "user-creator",
  opponentUserId: null,
  expiresAt: "2026-05-19T10:00:00Z",
  createdAt: "2026-05-12T10:00:00Z",
  // ... matches serializeBet return type exactly
};

describe("BetCard", () => {
  it("renders bet status badge + stake formatted as USDC", () => {
    render(<BetCard bet={mockBet} />);
    expect(screen.getByText("OPEN")).toBeInTheDocument();
    expect(screen.getByText(/1\.00 USDC/)).toBeInTheDocument();
  });

  it("shows 'open for accept' when opponentUserId is null", () => {
    render(<BetCard bet={mockBet} />);
    expect(screen.getByText(/open for accept/i)).toBeInTheDocument();
  });
});
```

## Test pattern reference (BetList met TanStack Query)

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "@/lib/test/render";
import { BetList } from "@/components/bet-list";

vi.mock("@/lib/api/client", () => ({
  listBets: vi.fn(),
}));
import { listBets } from "@/lib/api/client";

describe("BetList", () => {
  it("shows skeleton while loading", () => {
    (listBets as any).mockReturnValue(new Promise(() => {})); // never resolves
    renderWithQueryClient(<BetList status={undefined} />);
    expect(screen.getByTestId("bet-list-skeleton")).toBeInTheDocument();
  });

  it("renders fetched items", async () => {
    (listBets as any).mockResolvedValue({
      items: [mockBet, { ...mockBet, id: "bet-2" }],
      nextCursor: null,
    });
    renderWithQueryClient(<BetList status={undefined} />);
    await waitFor(() => expect(screen.getByText("bet-1")).toBeInTheDocument());
    expect(screen.getByText("bet-2")).toBeInTheDocument();
  });

  it("shows error alert on API failure", async () => {
    (listBets as any).mockRejectedValue(new Error("network"));
    renderWithQueryClient(<BetList status={undefined} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
```

## Post-flight checks

- Geen breaking changes op P07–P17 backend — alle bestaande tests groen.
- `getCurrentUser()` blijft single source of truth voor server-side auth; geen parallelle session-state in frontend.
- BigInt → string in alle responses; client toont via `formatUSDC(stakeUnits)` helper (NEW in `src/lib/api/client.ts` of `src/lib/format.ts`).
- Pino-signature grep clean op alle nieuwe `src/app/**/page.tsx` en API client (P15 regression-class).
- Bundle size sanity: `pnpm build` toont route sizes. Privy SDK is heavy (~150KB); accepteer in Phase 1, `dynamic import` overweging in P19 als FCP issue.

## Niet-doelen post-P18

- Create bet flow (P18.5).
- Wallet signing UX (P18.5).
- Mobile-responsive polish (P21).
- E2E tests (P22).
- i18n / locale (post-MVP).
- Dark mode toggle (shadcn default = dark, polish later).
- SEO meta tags (post-MVP).
- ISR / static generation voor public pages (post-MVP).

## Open questions / risks

1. **Privy frontend SDK versie**: pin op laatste stable, verifieer compat met backend Privy server SDK (`@privy-io/server-auth`). Backend versie te vinden via `pnpm list @privy-io/server-auth` in B.0.
2. **TanStack Query v5 SSR**: dehydration in server components is niet trivial. Phase 1 = client-only fetching voor simplicity; server components passen "initial data" als prop. Volledige SSR-hydration komt P19.
3. **shadcn theme**: default is dark mode. Bewust geen toggle = MVP-keuze; light mode komt P21+ (design system fase).
4. **`next/dynamic` voor Privy?**: Privy SDK is heavy. Mogelijk dynamic import voor `/sign-in` page in B.5 als bundle-size monitoring rood gaat. Phase 1 default = static import.
5. **WSL2 build-risico** (bekend uit P14/P15/P17): `pnpm build` kan segfaulten op WSL2. Marker `[BUILD PENDING — WSL2 V8 crash]` in commit message en Vercel CI canonical (zie [[zentrix-zod-type-helpers]]).
6. **Type-only fouten escaping naar Vercel** ([[zentrix-zod-type-helpers]]): bij introductie van API client wrappers met generic types, run één route-handler vitest die de wrapper gebruikt vóór push.
7. **Vercel CI rood = NOGO** ([[feedback_zentrix_p15_preflight_lessons]]): geen merge bij rode build, ongeacht GitHub merge-button state.
8. **Cookie-handling client-side**: Privy SDK schrijft `privy-token` automatisch. Verifieer in B.1 dat de cookie SameSite/Secure/HttpOnly attributes correct zijn voor zowel dev (`localhost`) als prod (`vercel.app`).

---

Linked: P17 spec `docs/PROMPT_17_read_endpoints.md` (backend reference), ADR-0001-architecture.md, ADR-0003-1v1-with-tournament-pools.md, [[feedback_zentrix_rules]] (review-then-execute), [[feedback_zentrix_p15_preflight_lessons]] (pre-flight discipline), [[zentrix-zod-type-helpers]] (type-helper testing).
