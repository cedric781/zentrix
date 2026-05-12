# P16: User-Write HTTP Routes — Bet/Dispute/Match Lifecycle Exposure

## Scope

### In
- 8 user-facing POST routes onder `src/app/api/` die de bestaande service-laag exposen.
- Gestandaardiseerde HTTP-helpers (`src/lib/http/`) voor: idempotency-key parsing met server-side UUID fallback, BigInt JSON-serializatie, en domain-error mapping.
- Vitest unit tests per route: happy path, unauthorized, service-error mapping, body validation.

### Out of scope (P16)
- GET / read endpoints (P17 voorgesteld: bets list/detail, pools list/detail, me/reputation).
- Admin endpoints (P18 voorgesteld: pool create/publish/close/cancel, match add/delete, dispute resolve, force-cancel-bet).
- Rate limiting / abuse prevention (later, vermoedelijk Upstash-gebaseerd).
- Schema migrations — P16 raakt `prisma/schema.prisma` niet.
- Frontend integratie (komt in latere UI-prompt).
- Replay-cache / idempotency-store buiten wat de services al doen — services hebben hun eigen `IdempotencyKey` tabel-logica.

## Design Decisions (locked)

### 1. Idempotency-Key — optioneel, server-side UUID fallback
- Client mag `Idempotency-Key` header sturen (case-insensitive). Indien aanwezig: valideren als UUID v4 (`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`). Invalide → 400 `INVALID_IDEMPOTENCY_KEY`.
- Indien afwezig: server genereert `crypto.randomUUID()` server-side. Client krijgt de gebruikte key terug in response-header `Idempotency-Key` zodat retries dezelfde key kunnen sturen.
- **Why:** De service-laag (`assertUuidV4` in createBet/acceptBet/cancelBet/proposeResult/confirmResult) eist UUID v4. HTTP-laag spiegelt dat contract zodat client en server dezelfde definitie van "geldige key" hebben. Server-fallback met `crypto.randomUUID()` voldoet automatisch.
- **Niet doen:** key uit body parsen (header-only conventie), key uit `userId+routePath+timestamp` afleiden (kan collide bij snelle dubbel-clicks), bredere regex toestaan (zou service-error doorlaten).

### 2. Caller-id is ALTIJD server-side uit `requireCurrentUser()`
- Geen `userId`, `callerId`, `creatorId`, `opponentUserId`, `openerId`, `uploaderId` in body schemas.
- Body schemas exposen alleen domain-input (side, stake, decision, reason, etc.).
- **Why:** Voorkomt impersonation; client kan niet via body een andere user-id meegeven.

### 3. BigInt over the wire: decimal string
- Request: `stakeUnits: z.string().regex(/^\d+$/).transform(BigInt)`.
- Response: `BigInt(value).toString()`. Per route handmatige map (geen recursive serializer; volg withdrawals-patroon).
- **Why:** JSON heeft geen BigInt; consistent met bestaande `withdrawals/route.ts`.

### 4. Error mapping — uniforme envelope
- Domain errors (`BetError`, `DisputeError`, `MatchError`) → `NextResponse.json({error: err.code, message: err.message}, {status: err.statusCode})`.
- `UnauthorizedError` (uit `@/lib/auth`) → `{error: "unauthorized"}` 401.
- Zod validation fail → `{error: "bad_body", issues: zod.error.issues}` 400.
- Ontbrekende idempotency-key (alleen als invalide) → `{error: "INVALID_IDEMPOTENCY_KEY"}` 400.
- Onbekende errors: re-throw → Next.js 500 default.
- **Why:** Frontend kan op `error` code switchen; messages zijn user-facing-acceptabel.

### 5. Next.js 15 async params
- Alle dynamic-segment routes: `{ params }: { params: Promise<{ id: string }> }`, `const { id } = await params;`.

### 6. Runtime = "nodejs"
- Prisma vereist Node runtime. Geen edge-routes in P16.

## Routes & service mapping

| # | Method | Path | Service | Body keys (post-zod) |
|---|---|---|---|---|
| 1 | POST | `/api/bets` | `createBet` | `side, stakeUnits, expiresInHours, poolId?, matchId?` |
| 2 | POST | `/api/bets/[id]/accept` | `acceptBet` | `inviteToken` |
| 3 | POST | `/api/bets/[id]/cancel` | `cancelBet` | (geen body) |
| 4 | POST | `/api/bets/[id]/propose-result` | `proposeResult` | `claimedWinnerId, note?` |
| 5 | POST | `/api/bets/[id]/confirm-result` | `confirmResult` | `decision, claimedWinnerId?` |
| 6 | POST | `/api/bets/[id]/disputes` | `openDispute` | `reason` |
| 7 | POST | `/api/disputes/[id]/evidence` | `submitDisputeEvidence` | `items[]` |
| 8 | POST | `/api/matches/[id]/result` | `submitMatchResult` | `winnerSide, evidence?[]` |

## Body schemas (zod)

```ts
// /api/bets
const CreateBetBody = z.object({
  side: z.enum(["A", "B"]),
  stakeUnits: z.string().regex(/^\d+$/),       // BigInt as decimal string
  expiresInHours: z.number().int().min(1).max(168),
  poolId: z.string().min(1).optional(),
  matchId: z.string().min(1).optional(),
});

// /api/bets/[id]/accept
const AcceptBetBody = z.object({
  inviteToken: z.string().min(8).max(256),
});

// /api/bets/[id]/cancel — geen body (zelfde-shape: z.object({}).optional() of skip parse)

// /api/bets/[id]/propose-result
const ProposeResultBody = z.object({
  claimedWinnerId: z.string().min(1),
  note: z.string().max(500).optional(),
});

// /api/bets/[id]/confirm-result
const ConfirmResultBody = z.object({
  decision: z.enum(["CONFIRM_WINNER", "DISAGREE"]),
  claimedWinnerId: z.string().min(1).optional(),
});

// /api/bets/[id]/disputes
const OpenDisputeBody = z.object({
  reason: z.string().min(10).max(1000),
});

// /api/disputes/[id]/evidence
const EvidenceItem = z.object({
  type: z.enum(["TEXT", "URL", "IMAGE", "VIDEO"]),
  fileUrl: z.string().url().optional(),
  contentHash: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
});
const SubmitEvidenceBody = z.object({
  items: z.array(EvidenceItem).min(1).max(10),
});

// /api/matches/[id]/result
const MatchEvidenceItem = EvidenceItem.extend({
  mimeType: z.string().max(128).optional(),
});
const MatchResultBody = z.object({
  winnerSide: z.enum(["A", "B"]),
  evidence: z.array(MatchEvidenceItem).max(10).optional(),
});
```

## HTTP helpers — `src/lib/http/`

### `idempotency.ts`
```ts
import { randomUUID } from "node:crypto";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class InvalidIdempotencyKeyError extends Error {}
export function parseIdempotencyKey(req: Request): string {
  const raw = req.headers.get("idempotency-key");
  if (raw === null || raw === "") return randomUUID();
  if (!UUID_V4.test(raw)) throw new InvalidIdempotencyKeyError();
  return raw;
}
```

### `bigint.ts`
```ts
export const bigToStr = (b: bigint | null | undefined): string | null =>
  b === null || b === undefined ? null : b.toString();
```

### `errors.ts`
```ts
import { NextResponse } from "next/server";
import { BetError } from "@/lib/bets/errors";
import { DisputeError } from "@/lib/disputes/errors";
import { MatchError } from "@/lib/matches/errors";
import { UnauthorizedError } from "@/lib/auth";
import { InvalidIdempotencyKeyError } from "./idempotency";

export function mapDomainError(err: unknown): NextResponse | null {
  if (err instanceof UnauthorizedError)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (err instanceof InvalidIdempotencyKeyError)
    return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
  if (err instanceof BetError || err instanceof DisputeError || err instanceof MatchError)
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.statusCode });
  return null;
}
```

## Fasering (commits)

### B.0 — HTTP helpers + eerste route (POST /api/bets)
- `src/lib/http/idempotency.ts`
- `src/lib/http/bigint.ts`
- `src/lib/http/errors.ts`
- `src/app/api/bets/route.ts` (POST createBet)
- Commit: `feat(http): P16 B.0 — HTTP helpers + POST /api/bets`

### B.1 — Bet lifecycle routes (4)
- `/api/bets/[id]/accept/route.ts`
- `/api/bets/[id]/cancel/route.ts`
- `/api/bets/[id]/propose-result/route.ts`
- `/api/bets/[id]/confirm-result/route.ts`
- Commit: `feat(http): P16 B.1 — bet lifecycle routes (accept/cancel/propose/confirm)`

### B.2 — Disputes + match-result routes (3)
- `/api/bets/[id]/disputes/route.ts`
- `/api/disputes/[id]/evidence/route.ts`
- `/api/matches/[id]/result/route.ts`
- Commit: `feat(http): P16 B.2 — dispute + match result routes`

### B.3 — Vitest route-handler tests
- Per route minimum 4 cases: happy / 401 / 400 zod / domain-error mapping.
- Mock `@/lib/auth.requireCurrentUser` en de relevante service-functie via `vi.mock`.
- Import handler direct: `import { POST } from "@/app/api/bets/route"`.
- Geen DB-roundtrip; pure handler-laag tests.
- Commit: `test(http): P16 B.3 — route-handler tests`

## Test patroon (reference)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/service", () => ({
  createBet: vi.fn(),
}));

import { POST } from "@/app/api/bets/route";
import { requireCurrentUser } from "@/lib/auth";
import { createBet } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";

const makeReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/bets", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("POST /api/bets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with serialized bet", async () => {
    (requireCurrentUser as any).mockResolvedValue({ id: "u1" });
    (createBet as any).mockResolvedValue({
      bet: { id: "b1", stakeUnits: 1000n, status: "OPEN" },
      inviteToken: "tok",
    });
    const res = await POST(makeReq({
      side: "A", stakeUnits: "1000", expiresInHours: 24,
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bet.stakeUnits).toBe("1000");
    expect(json.inviteToken).toBe("tok");
  });

  it("unauthorized → 401", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    (requireCurrentUser as any).mockRejectedValue(new UnauthorizedError());
    const res = await POST(makeReq({ side: "A", stakeUnits: "1000", expiresInHours: 24 }));
    expect(res.status).toBe(401);
  });

  it("bad body → 400", async () => {
    (requireCurrentUser as any).mockResolvedValue({ id: "u1" });
    const res = await POST(makeReq({ side: "X" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("domain error → mapped status & code", async () => {
    (requireCurrentUser as any).mockResolvedValue({ id: "u1" });
    (createBet as any).mockRejectedValue(new BetError("BET_INVALID_INPUT", "...", 400));
    const res = await POST(makeReq({ side: "A", stakeUnits: "1000", expiresInHours: 24 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("BET_INVALID_INPUT");
  });
});
```

## Open questions / risks
- **WSL2 typecheck**: bekend SIGILL/SIGSEGV-issue uit P14/P15. Bij persistente crash markeer commits met `[TYPECHECK PENDING — WSL2 V8 crash]` en vertrouw op Vercel CI als primary verifier (zelfde patroon).
- **Idempotency UUID fallback**: server-generated keys betekenen geen client-side replay-safety; eerste-call wint, retries krijgen nieuwe key tenzij client zelf de key vasthoudt. Documentatie nodig in latere client-prompt.
- **Privy cookie auth**: `requireCurrentUser` leest `privy-token` cookie. Vitest tests bypassen dit via mock; CSRF / cookie-flow zelf wordt niet door P16 tests gedekt — moet via E2E later.

## Niet-doelen post-P16
- Frontend hooks/components (latere prompt).
- WebSocket / SSE notificaties.
- Multi-tenant / partner-API.
