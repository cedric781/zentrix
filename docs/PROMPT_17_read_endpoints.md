# P17: Read endpoints + admin actions

## Doel

HTTP read-laag voor user-facing en admin views, plus admin POST endpoints voor dispute resolution en force-cancel. Builds on P16 (write routes) en P09–P14 services. Geen schema-migraties, geen frontend, geen rate-limiting.

## Builds on

- **P07** ledger — geen wijzigingen.
- **P09–P14** service-laag — read-services worden TOEGEVOEGD; bestaande write-services worden hergebruikt voor de 2 admin POSTs (`resolveDispute`, `forceCancelBet`).
- **P16** HTTP routes — alle helpers (`bigToStr`, `mapDomainError`), serializers (`serializeBet`, `serializeDispute`, `serializeMatch`, `serializeBetResultClaim`, `serializeBetParticipantConfirmation`), test-fixtures (`_fixtures.ts`).
- **`src/lib/admin.ts`** — `requireAdmin` token-auth pattern bestaat al, P17 hergebruikt direct.
- **`src/lib/auth.ts`** — `requireCurrentUser` / Privy session bestaat al, P17 hergebruikt direct.

## Scope

### In
- 9 user-facing GET routes (bets list/detail, disputes list/detail, pools list/detail, match detail, me/reputation, me/balance).
- 4 admin GET routes (disputes queue, dispute detail, users list, bets admin view).
- 2 admin POST routes (`/admin/disputes/[id]/resolve`, `/admin/bets/[id]/force-cancel`).
- 5 read-services in domain libraries (`src/lib/{bets,disputes,pools,matches,reputation}/read.ts`).
- 2 nieuwe HTTP helpers (`pagination.ts`, `query.ts`).
- 5 nieuwe serializers in `serialize.ts` (`serializeUser`, `serializePool`, `serializeReputation`, `serializeFinancialAccount`, `serializePagination<T>`).
- Vitest unit tests per route + helper tests.

### Out of scope (P17)
- Admin UI / user-facing frontend pages (P18+).
- WebSocket/SSE real-time updates.
- Caching (ISR/Redis/etc — P19+).
- Rate limiting per user (P19+).
- KYC compliance flow.
- Withdrawal endpoints (Privy-direct, geen queue per P15 incident).
- Per-user admin allowlist (token-only blijft).
- Audit-log read endpoint (P18+).
- Full-text search (`searchQ` is placeholder, geen Postgres FTS-implementatie).
- `/api/templates` (Zentrix is custom bets, geen template library).
- `/api/system-status` public banner (P19+).
- Schema migrations — P17 raakt `prisma/schema.prisma` niet.

## Pre-flight

- `git status` clean.
- `git log -1` op main = `6faa255` (P15 hotfix in main).
- `pnpm test` baseline = 178/178 groen (146 P14 + 32 P16).
- `src/lib/http/` heeft 4 files: `bigint.ts`, `errors.ts`, `idempotency.ts`, `serialize.ts`.
- `requireAdmin` werkt in 2 bestaande routes (`/api/admin/metrics`, `/api/admin/breakers`).
- Branch: `wip-p17-routes` vanaf main `6faa255` (niet stacked op andere wip-* branches).

## Design Decisions (locked)

### 1. Read-service signatures — uniform patroon

```ts
// list (user-scoped of admin-scoped, beide via dezelfde signature met optional userId)
listX({ userId?, status?, cursor?, take? }): Promise<{ items: X[], nextCursor: string | null }>

// get (single) — userId? optioneel: admin skip ownership-check
getX({ id, userId? }): Promise<X | null>
```

- `userId` weggelaten = admin-call, full visibility. Aanwezig = user-scoped, ownership filter.
- `listX` voor admin gebruikt aparte signature met `{ offset, take }` i.p.v. `{ cursor, take }` (zie beslissing 3).

### 2. Pagination — cursor (user-facing)

- Cursor = base64-encoded `{ id: string, createdAt: ISO }` voor tie-stability bij gelijke timestamps.
- `parseCursor()` throws `InvalidCursorError` → `mapDomainError` → 400.
- `take` cap: `min(requested, 50)`, default 20.
- Response shape: `{ items: X[], nextCursor: string | null }`.

**Why:** Cursor pagineren is correct bij high-churn read sets (nieuwe bets verschijnen continu). Base64 envelope houdt het wire-format opaque voor de client (kan niet handcraften).

### 3. Pagination — offset (admin only)

- `skip + take`, `take` cap 100, default 25.
- Response shape: `{ items: X[], total: number, offset: number, take: number, hasMore: boolean }`.
- `total` via `prisma.X.count()` met dezelfde WHERE als de lijst-query.

**Why:** Admin moet kunnen springen naar pagina N en totaal-aantal zien. User-facing geeft je dat niet (cursor heeft geen "pagina N" concept).

### 4. Ownership filtering — user-facing

| Resource | WHERE-clause |
|---|---|
| `listBets` | `createdById = user.id OR opponentUserId = user.id` |
| `listDisputes` | `openedById = user.id OR bet.createdById = user.id OR bet.opponentUserId = user.id` |
| `listPools` | `createdById = user.id` |
| `getBet` / `getDispute` / `getPool` | retourneer `null` (→ 404) als user geen owner/participant is |
| `getMatch` | Match heeft geen direct User-relation. Access: user is creator van de parent Pool (`match.pool.createdById = user.id`) OF heeft ≥1 Bet op deze match (`bet.matchId = match.id AND (bet.createdById = user.id OR bet.opponentUserId = user.id)`). Anders `null` → 404. |

**Why 404 i.p.v. 403:** existence niet lekken (anders kan een attacker bet-IDs proben).

### 5. Ownership filtering — admin

- Geen ownership filter; volledige zichtbaarheid.
- Status filter MOET (default `status="OPEN"` voor disputes queue — anders explodeert payload op grote datasets).

### 6. Query params (zod-validated)

- `status`: enum per resource (`BetStatus` / `DisputeStatus` / `PoolStatus` / `MatchStatus`).
- `sortBy`: enum (`"createdAt" | "expiresAt"`), default `createdAt desc`.
- `cursor` OF `offset+take` (one of, never both — mutually exclusive in zod).
- `searchQ`: optional string, **admin only**. Placeholder voor toekomstige full-text search (P19+). In P17: parameter geaccepteerd in zod, **niet** in WHERE-clause.

### 7. Response shape uniformity

| Type | Shape |
|---|---|
| Single resource | `{ data: X }` |
| User-facing list | `{ items: X[], nextCursor: string \| null }` |
| Admin list | `{ items: X[], total: number, offset: number, take: number, hasMore: boolean }` |
| Errors | Identiek aan P16 (`mapDomainError` envelope) |

### 8. BigInt serialisatie

- Alle bigint velden via `bigToStr` (zelfde patroon als P16).
- JSON responses bevatten strings voor `stakeUnits`, `balanceUnits`, `version`, etc.

### 9. Admin dispute resolve

- `POST /api/admin/disputes/[id]/resolve`
- Body: `{ outcome: DisputeOutcome, reasoning: string, actorAdminId?: string }`
- Roept `resolveDispute` service aan; `actorAdminId` doorgegeven als audit-metadata (NIET als auth — auth is token-only).
- Idempotency: `Idempotency-Key` header optional, zelfde UUID v4 contract als P16. Dispute resolution is van nature non-idempotent (eerste call wint); de header dient als safety-net voor retry-storms.

### 10. Admin bet force-cancel

- `POST /api/admin/bets/[id]/force-cancel`
- Body: `{ reason: string, actorAdminId?: string }`
- Roept `forceCancelBet` service aan; `actorAdminId` als audit-metadata.

### 11. Test admin-mock pattern

```ts
vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
```

- Test-fixture `mockAdminToken()` helper voor request setup (geeft een Bearer header met dummy token).
- Sad path: `requireAdmin` throws `AdminAuthError` → expect 401 response.

### 12. Route caching — alle P17 routes dynamic

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

- Geen ISR/SSG; reads zijn altijd live.
- Consistent met bestaand admin-route patroon (`/api/admin/metrics`, `/api/admin/breakers` hebben beide `force-dynamic`).

## Routes & service mapping

### User-facing GET routes

| # | Method | Path | Service | Query params |
|---|---|---|---|---|
| 1 | GET | `/api/bets` | `listBets({ userId, ... })` | `status?, sortBy?, cursor?, take?` |
| 2 | GET | `/api/bets/[id]` | `getBet({ id, userId })` | — |
| 3 | GET | `/api/disputes` | `listDisputes({ userId, ... })` | `status?, sortBy?, cursor?, take?` |
| 4 | GET | `/api/disputes/[id]` | `getDispute({ id, userId })` | — |
| 5 | GET | `/api/pools` | `listPools({ userId, ... })` | `status?, sortBy?, cursor?, take?` |
| 6 | GET | `/api/pools/[id]` | `getPool({ id, userId })` | — |
| 7 | GET | `/api/matches/[id]` | `getMatch({ id, userId })` | — |
| 8 | GET | `/api/me/reputation` | `getUserReputation(userId)` (bestaat al) | — |
| 9 | GET | `/api/me/balance` | direct `prisma.financialAccount.findUnique` | — |

### Admin GET routes

| # | Method | Path | Service | Query params |
|---|---|---|---|---|
| 10 | GET | `/api/admin/disputes` | `listDisputesAdmin({ ... })` | `status?, sortBy?, offset?, take?, searchQ?` |
| 11 | GET | `/api/admin/disputes/[id]` | `getDispute({ id })` (admin: no userId) | — |
| 12 | GET | `/api/admin/users` | `listUsersAdmin({ ... })` | `offset?, take?, searchQ?` |
| 13 | GET | `/api/admin/bets` | `listBetsAdmin({ ... })` | `status?, sortBy?, offset?, take?, searchQ?` |

### Admin POST routes

| # | Method | Path | Service | Body keys (post-zod) |
|---|---|---|---|---|
| 14 | POST | `/api/admin/disputes/[id]/resolve` | `resolveDispute` | `outcome, reasoning, actorAdminId?` |
| 15 | POST | `/api/admin/bets/[id]/force-cancel` | `forceCancelBet` | `reason, actorAdminId?` |

## Files touched

### NEW (read services)
- `src/lib/bets/read.ts` — `listBets`, `getBet`, `listBetsAdmin`
- `src/lib/disputes/read.ts` — `listDisputes`, `getDispute`, `listDisputesAdmin`
- `src/lib/pools/read.ts` — `listPools`, `getPool`
- `src/lib/matches/read.ts` — `getMatch` (list gaat via Pool)
- `src/lib/reputation/read.ts` — re-export van bestaande `getUserReputation`
- `src/lib/admin/users.ts` — `listUsersAdmin`

### NEW (HTTP helpers)
- `src/lib/http/pagination.ts` — `parseCursor`, `encodeCursor`, `decodeCursor`, `InvalidCursorError`, `parseOffsetTake`
- `src/lib/http/query.ts` — zod query-param parser helpers (`parseListQuery`, `parseAdminListQuery`)

### NEW (user-facing GET routes)
- `src/app/api/bets/route.ts` (extend bestaand POST met GET handler)
- `src/app/api/bets/[id]/route.ts`
- `src/app/api/disputes/route.ts`
- `src/app/api/disputes/[id]/route.ts`
- `src/app/api/pools/route.ts`
- `src/app/api/pools/[id]/route.ts`
- `src/app/api/matches/[id]/route.ts` (extend bestaand POST met GET)
- `src/app/api/me/reputation/route.ts`
- `src/app/api/me/balance/route.ts`

### NEW (admin GET routes)
- `src/app/api/admin/disputes/route.ts`
- `src/app/api/admin/disputes/[id]/route.ts`
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/bets/route.ts`

### NEW (admin POST routes)
- `src/app/api/admin/disputes/[id]/resolve/route.ts`
- `src/app/api/admin/bets/[id]/force-cancel/route.ts`

### EXTEND (serializers)
- `src/lib/http/serialize.ts` — add:
  - `serializeUser(u)` — id, privyId, email, embeddedWalletAddress, createdAt (geen sensitive velden)
  - `serializePool(p)` — id, name, status, createdById, etc.
  - `serializeReputation(r)` — score, tier, breakdown
  - `serializeFinancialAccount(fa)` — balanceUnits (string via bigToStr), pendingUnits, lastUpdated
  - `serializePagination<T>(items, opts)` — wraps list response in `{ items, nextCursor }` of `{ items, total, offset, take, hasMore }`

### NEW (tests)
- `src/__tests__/http/bets-list.test.ts`
- `src/__tests__/http/bets-get.test.ts`
- `src/__tests__/http/disputes-list.test.ts`
- `src/__tests__/http/disputes-get.test.ts`
- `src/__tests__/http/pools-list.test.ts`
- `src/__tests__/http/pools-get.test.ts`
- `src/__tests__/http/matches-get.test.ts`
- `src/__tests__/http/me-reputation.test.ts`
- `src/__tests__/http/me-balance.test.ts`
- `src/__tests__/http/admin-disputes-list.test.ts`
- `src/__tests__/http/admin-disputes-get.test.ts`
- `src/__tests__/http/admin-disputes-resolve.test.ts`
- `src/__tests__/http/admin-bets-force-cancel.test.ts`
- `src/__tests__/http/admin-users-list.test.ts`
- `src/__tests__/http/_pagination.test.ts` (helper tests)

### EXTEND (test infra)
- `src/__tests__/http/_fixtures.ts` — add: `mockAdminToken()` helper, `mockPagination`, `mockReputation`, `mockFinancialAccount`, `mockUser`, `mockPool`

## HTTP helpers — `src/lib/http/`

### `pagination.ts`

```ts
import { z } from "zod";

export class InvalidCursorError extends Error {
  constructor(msg = "Invalid pagination cursor") {
    super(msg);
    this.name = "InvalidCursorError";
  }
}

interface CursorPayload { id: string; createdAt: string }

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): CursorPayload {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (typeof parsed?.id !== "string" || typeof parsed?.createdAt !== "string") {
      throw new InvalidCursorError();
    }
    return parsed;
  } catch {
    throw new InvalidCursorError();
  }
}

export const CursorQuery = z.object({
  cursor: z.string().min(1).optional(),
  take: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const OffsetQuery = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  take: z.coerce.number().int().min(1).max(100).optional().default(25),
});
```

### `query.ts`

```ts
import { z } from "zod";
import { CursorQuery, OffsetQuery } from "./pagination";

export const SortByEnum = z.enum(["createdAt", "expiresAt"]).optional().default("createdAt");

export function parseListQuery(req: Request, statusEnum: z.ZodEnum<any>) {
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  return z.object({
    status: statusEnum.optional(),
    sortBy: SortByEnum,
  }).merge(CursorQuery).parse(raw);
}

export function parseAdminListQuery(req: Request, statusEnum: z.ZodEnum<any>) {
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  return z.object({
    status: statusEnum.optional(),
    sortBy: SortByEnum,
    searchQ: z.string().max(200).optional(),
  }).merge(OffsetQuery).parse(raw);
}
```

## Body schemas (admin POSTs)

```ts
// /api/admin/disputes/[id]/resolve
const ResolveDisputeBody = z.object({
  outcome: z.enum(["CREATOR_WIN", "OPPONENT_WIN", "VOID"]),
  reasoning: z.string().min(10).max(2000),
  actorAdminId: z.string().min(1).max(100).optional(),
});

// /api/admin/bets/[id]/force-cancel
const ForceCancelBody = z.object({
  reason: z.string().min(10).max(1000),
  actorAdminId: z.string().min(1).max(100).optional(),
});
```

## Fasering (commits)

### B.0 — HTTP helpers + pagination tests
- `src/lib/http/pagination.ts`
- `src/lib/http/query.ts`
- `src/__tests__/http/_pagination.test.ts` (~6 tests: encode/decode roundtrip, invalid cursor, offset clamping, take bounds, default values)
- Commit: `feat(http): P17 B.0 — pagination + query helpers`

### B.1 — Read services per domain
- `src/lib/bets/read.ts`, `src/lib/disputes/read.ts`, `src/lib/pools/read.ts`, `src/lib/matches/read.ts`, `src/lib/reputation/read.ts`, `src/lib/admin/users.ts`
- Geen unit tests in deze fase (gedekt via HTTP integration tests in B.2/B.3/B.4).
- Commit: `feat(reads): P17 B.1 — listX/getX services per domain`

### B.2 — User-facing GET routes (9 endpoints)
- Routes onder `src/app/api/{bets,disputes,pools,matches,me}/...`
- 9 test files in `src/__tests__/http/`, ~3-5 tests per endpoint (~30 tests totaal: happy, 401, 400 invalid-cursor, 404 not-found-or-not-owner, ownership-filter sanity)
- Commit: `feat(http): P17 B.2 — user-facing GET endpoints`

### B.3 — Admin GET routes (4 endpoints)
- Routes onder `src/app/api/admin/{disputes,users,bets}/...`
- 4 test files met admin-mock pattern (~16 tests: happy, 401 admin-auth-fail, offset/take clamping, status filter, optional searchQ accepted)
- Commit: `feat(http): P17 B.3 — admin GET endpoints`

### B.4 — Admin POST routes (2 endpoints)
- `/api/admin/disputes/[id]/resolve` + `/api/admin/bets/[id]/force-cancel`
- 2 test files (~8 tests: happy, 401, 400 zod, domain-error mapping)
- Commit: `feat(http): P17 B.4 — admin POST endpoints (resolve, force-cancel)`

### B.5 — Serializer extensions
- Extend `src/lib/http/serialize.ts`: `serializeUser`, `serializePool`, `serializeReputation`, `serializeFinancialAccount`, `serializePagination<T>`
- Geen aparte tests; gedekt via response-shape assertions in B.2/B.3/B.4 tests
- Commit: `feat(http): P17 B.5 — serializers for new shapes`

### B.6 — Full suite verify + PR
- `pnpm test` = baseline 178 + ~60 new ≈ ~238 groen.
- `npx tsc --noEmit` clean (op Codespaces / Vercel CI, NIET WSL per [[feedback_zentrix_p15_preflight_lessons]]).
- Push `wip-p17-routes` → remote.
- PR draft. **NIET mergen tot Vercel CI groen** (P15-incident lesson).

## Test patroon (admin-auth reference)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/disputes/service", () => ({
  resolveDispute: vi.fn(),
}));

import { POST } from "@/app/api/admin/disputes/[id]/resolve/route";
import { requireAdmin } from "@/lib/admin";
import { resolveDispute } from "@/lib/disputes/service";
import { DisputeError } from "@/lib/disputes/errors";

const makeReq = (body: unknown) =>
  new Request("http://x/api/admin/disputes/d1/resolve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-admin-token",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/disputes/[id]/resolve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with resolved dispute", async () => {
    (requireAdmin as any).mockResolvedValue(undefined);
    (resolveDispute as any).mockResolvedValue({
      dispute: { id: "d1", status: "RESOLVED", outcome: "CREATOR_WIN" },
    });
    const res = await POST(makeReq({
      outcome: "CREATOR_WIN",
      reasoning: "Evidence clearly shows creator side won.",
      actorAdminId: "admin-rapha",
    }), { params: Promise.resolve({ id: "d1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe("RESOLVED");
  });

  it("admin auth fail → 401", async () => {
    const { AdminAuthError } = await import("@/lib/admin");
    (requireAdmin as any).mockRejectedValue(new AdminAuthError());
    const res = await POST(makeReq({
      outcome: "CREATOR_WIN",
      reasoning: "test reasoning over 10 chars",
    }), { params: Promise.resolve({ id: "d1" }) });
    expect(res.status).toBe(401);
  });

  it("bad body → 400", async () => {
    (requireAdmin as any).mockResolvedValue(undefined);
    const res = await POST(makeReq({ outcome: "INVALID" }), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(400);
  });

  it("domain error mapped", async () => {
    (requireAdmin as any).mockResolvedValue(undefined);
    (resolveDispute as any).mockRejectedValue(
      new DisputeError("DISPUTE_NOT_FOUND", "...", 404),
    );
    const res = await POST(makeReq({
      outcome: "CREATOR_WIN",
      reasoning: "test reasoning over 10 chars",
    }), { params: Promise.resolve({ id: "d1" }) });
    expect(res.status).toBe(404);
  });
});
```

## Post-flight checks

- Geen breaking changes op P16 endpoints — alle P16 test files moeten groen blijven zonder wijzigingen.
- HTTP response shapes stable; geen ad-hoc velden buiten de gedocumenteerde envelope.
- BigInt → string conversie consistent in alle responses (geen rauwe `BigInt` waarden in JSON).
- Ownership-filter sanity: vitest assertion dat `listBets({ userId: "other" })` geen rows van current user returns.
- Cursor roundtrip: encode → decode geeft originele payload terug; corrupte cursor → 400.

## Open questions / risks

1. **Cursor format**: `{ id, createdAt }` base64 voor tie-stability bij gelijke timestamps — voorstel locked. Alternatief: alleen `id` (simpler maar instabiel bij ties). **Voorstel: id+createdAt.**
2. **`/api/admin/users` response**: include `FinancialAccount.balanceUnits`? Admin-behoefte rechtvaardigt het, security-impact verwaarloosbaar (admin heeft al token). **Voorstel: ja, include.**
3. **`force-dynamic` op alle P17 routes vs. alleen mutating**: alle routes voor consistency met admin pattern. **Voorstel: alle.**
4. **WSL2 typecheck-risico** (bekend uit P14/P15): bij persistente crash markeer commits met `[TYPECHECK PENDING — WSL2 V8 crash]` en vertrouw op Vercel CI. Zelfde patroon als P16.
5. **Pino logger signature** (lesson uit [[feedback_zentrix_p15_preflight_lessons]]): alle nieuwe `logger.X(...)` aanroepen MOETEN `(obj, msg)` shape gebruiken. Pre-flight grep checken vóór PR.
6. **Vercel CI rood = NOGO** (lesson uit P15-incident): geen merge bij rode build, ongeacht GitHub merge-button state.

## Niet-doelen post-P17

- Frontend hooks / React components (latere prompt).
- Multi-tenant / partner-API.
- GraphQL laag (REST blijft canoniek).
- OpenAPI/Swagger doc generatie.
