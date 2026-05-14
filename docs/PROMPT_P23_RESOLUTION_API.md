# PROMPT_P23 — Resolution API endpoints (5 routes)

**Status:** Spec — execution prompt.

## Context

P22 LIVE op productie (commit 998c004). Settlement architecture klaar:
- 15 templates in `bet_templates` (P21)
- SettlementMethod enum + 4 method services + router (P22)
- Loose coupling: services return decisions, P23 wraps existing Zentrix services

P23 = vierde stap van Wager P2P template architecture roadmap (P20-P25):
- ✅ P20 — BetTemplate model
- ✅ P21 — 15 templates seeded
- ✅ P22 — SettlementMethod enum + 4 method services
- **P23** — Resolution API endpoints (deze prompt)
- P24 — Frontend wizard architecture
- P25 — Frontend create-bet wizard

P23 maakt P20-P22 work bruikbaar voor frontend P24-P25.

## Scope

### In scope — 5 endpoints

```
1. GET  /api/templates                    List 15 templates (filter op category)
2. GET  /api/templates/[slug]             Template detail
3. POST /api/bets/[id]/propose-result     Wraps proposeResult service
4. POST /api/bets/[id]/confirm-result     Wraps confirmResult service
5. POST /api/bets/[id]/resolve            Facade — calls router.resolveBet (future auto-resolve)
```

Plus:
- `src/lib/templates/service.ts` — template list + get functions
- `src/lib/http/serialize.ts` — add `serializeTemplate` function
- 5 test files (3-5 cases per endpoint = ~20 tests)
- Spec doc op `docs/PROMPT_P23_RESOLUTION_API.md`

### Out of scope

- Admin endpoints (templates create/update/delete) — separate prompt
- Cancel-bet endpoint (P15 cron handles expire)
- Dispute endpoints (P13 services exist, API in separate prompt)
- Working OFFICIAL_RESULT auto-fetch (P22 stub blijft)
- Frontend (P24-P25)
- Webhook triggers voor /resolve (P22 router blijft dead code voor MVP)
- New service.ts changes (loose coupling)

## Wager pattern alignment

Endpoint names volgen Wager v2 conventie:
- `submit-proof` → wij `propose-result` (matcht Zentrix's bestaande proposeResult service)
- `confirm` → wij `confirm-result` (matcht Zentrix's bestaande confirmResult service)

**We porten NIET Wager v2's settlement complexity** (30+ tests, 8 lib files, workers, oracle endpoints). Memory: "127 routes voor 20 operations" = anti-pattern. Wij doen 5 routes voor 5 operations.

## Design decisions

### 1. Endpoint structure

Alle endpoints volgen Zentrix's bestaande pattern (zie `src/app/api/bets/route.ts`):
- Zod body validation
- `requireCurrentUser` voor auth (returns User, throws UnauthorizedError)
- Try/catch met DisputeError-style error mapping
- Returns `{ ok: true, data: ... }` of `{ ok: false, error: { code, message } }`

### 2. GET /api/templates — list endpoint

```typescript
// Query params (alle optioneel):
?category=Sport         // filter op category
?settlementMethod=PLATFORM_PROOF  // filter op settlementMethod
?activeOnly=true        // default true: alleen isActive=true && deletedAt=null

// Response:
{
  ok: true,
  data: {
    templates: SerializedTemplate[],
    total: number,
  }
}
```

Sort: `name ASC`. Geen pagination (15 templates, geen overhead nodig).

### 3. GET /api/templates/[slug] — detail endpoint

```typescript
// Response 200:
{
  ok: true,
  data: { template: SerializedTemplate }
}

// Response 404:
{
  ok: false,
  error: { code: "TEMPLATE_NOT_FOUND", message: "..." }
}
```

Includes soft-deleted check (`deletedAt = null` only).

### 4. POST /api/bets/[id]/propose-result — wrap proposeResult

```typescript
// Body (Zod validated):
{
  claimedWinnerSide: "A" | "B",   // welke kant gewonnen
  note?: string                    // max 1000 chars, optioneel proof note
}

// Auth: requireCurrentUser, must be participant (creator OR opponent)
// State transition: ACCEPTED → RESULT_PROPOSED (state machine in proposeResult)
// Response 200: { ok: true, data: { bet: SerializedBet, claim: SerializedClaim } }
// Response 400: invalid body / wrong state / not participant
```

Service: `proposeResult` uit `@/lib/bets/service`. Already exported.

### 5. POST /api/bets/[id]/confirm-result — wrap confirmResult

```typescript
// Body:
{
  confirmation: "AGREE" | "DISPUTE"   // simpel of agreement of dispute trigger
}

// AGREE → confirmResult service → settleBet internal → SETTLED
// DISPUTE → triggers P13 dispute flow (separate endpoint later, voor MVP returns 400)
//
// Auth: must be participant (NOT the proposer)
// Response 200: { ok: true, data: { bet: SerializedBet } }
```

Service: `confirmResult` uit `@/lib/bets/service`.

### 6. POST /api/bets/[id]/resolve — facade endpoint

**Future-proof endpoint** voor template-aware resolution. Calls `router.resolveBet` (P22).

```typescript
// Body (method-dependent):
{
  method: "PLATFORM_PROOF" | "OFFICIAL_RESULT",
  proof: {
    // PLATFORM_PROOF: { winnerSide: "A" | "B" | "VOID" }
    // OFFICIAL_RESULT: { sourceUrl: string, resultData: {...} }
  }
}

// Auth: requireCurrentUser
// Loads Bet + Template, calls router.resolveBet
// Returns ResolveBetResult — does NOT commit to DB (P22 design)
//
// P22 router DOES NOT call settleBet — that's intentional.
// P23 /resolve returns the DECISION for frontend visibility.
// Actual commit happens via /propose-result + /confirm-result flow.
```

**KRITIEK:** /resolve is **information-only**. Geen DB writes. P22 facade design preserveert loose coupling. Frontend gebruikt /resolve om te zien WAT de auto-resolution zou doen, niet om het uit te voeren.

For PLATFORM_PROOF templates: frontend zal /propose-result + /confirm-result gebruiken (manual flow).
For OFFICIAL_RESULT (toekomst): /resolve toont het auto-resolved decision, daarna /propose-result + /confirm-result committen.

### 7. Template serialize

```typescript
// src/lib/http/serialize.ts — nieuwe functie:

export function serializeTemplate(template: BetTemplate) {
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    category: template.category,
    description: template.description,
    settlementType: template.settlementType,
    settlementMethod: template.settlementMethod,
    outcomeType: template.outcomeType,
    fieldsSchema: template.fieldsSchema,
    allowedSources: template.allowedSources,
    resolutionRule: template.resolutionRule,
    supportsAutoResolve: template.supportsAutoResolve,
    requiresOfficialEvent: template.requiresOfficialEvent,
    isActive: template.isActive,
    version: template.version,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
```

### 8. Template service

```typescript
// src/lib/templates/service.ts — nieuw file:

import { prisma } from "@/lib/prisma";
import type { BetTemplate, SettlementMethod } from "@prisma/client";

export interface ListTemplatesFilter {
  category?: string;
  settlementMethod?: SettlementMethod;
  activeOnly?: boolean;
}

export async function listTemplates(filter: ListTemplatesFilter = {}): Promise<BetTemplate[]> {
  const where: any = {};
  if (filter.category) where.category = filter.category;
  if (filter.settlementMethod) where.settlementMethod = filter.settlementMethod;
  if (filter.activeOnly !== false) {
    where.isActive = true;
    where.deletedAt = null;
  }
  
  return prisma.betTemplate.findMany({
    where,
    orderBy: { name: "asc" },
  });
}

export async function getTemplate(slug: string): Promise<BetTemplate | null> {
  return prisma.betTemplate.findFirst({
    where: { slug, deletedAt: null },
  });
}
```

### 9. Error codes (consistent met bestaande)

| Code | When | Status |
|---|---|---|
| `TEMPLATE_NOT_FOUND` | GET /api/templates/[slug] not found | 404 |
| `BET_NOT_FOUND` | Bet not exist | 404 |
| `BET_INVALID_STATE` | Wrong state transition | 400 |
| `NOT_PARTICIPANT` | User not creator/opponent | 403 |
| `INVALID_BODY` | Zod validation fail | 400 |
| `UNAUTHORIZED` | No session | 401 |
| `DISPUTE_REQUIRED` | Confirmation = DISPUTE (placeholder) | 400 |
| `INTERNAL` | Unexpected | 500 |

### 10. Auth pattern

```typescript
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";

// In route handler:
try {
  const user = await requireCurrentUser();
  // ... rest
} catch (e) {
  if (e instanceof UnauthorizedError) {
    return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  throw e;
}
```

### 11. State machine via existing services

P23 vertrouwt op state machine in `proposeResult` + `confirmResult` services. **No state checks in route handlers** — services throw `BetError` met juiste code, route maps naar HTTP status.

```typescript
import { BetError } from "@/lib/bets/errors";

try {
  const result = await proposeResult({ ... });
  return Response.json({ ok: true, data: { ... } });
} catch (e) {
  if (e instanceof BetError) {
    return Response.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.statusCode });
  }
  throw e;
}
```

### 12. Idempotency

`proposeResult` + `confirmResult` zijn idempotent via state machine (re-call after success = no-op of error). Geen `Idempotency-Key` header nodig op P23 endpoints. createBet pattern is anders (creates new resource).

### 13. /resolve does not commit

KRITIEK design: `/api/bets/[id]/resolve` calls `router.resolveBet` (P22) which returns `ResolveBetResult`. **Geen DB write.** Endpoint geeft een resolution DECISION terug. Frontend kan deze gebruiken voor preview/UI hints.

Actual settlement gebeurt via `/propose-result` + `/confirm-result` flow (existing Zentrix services).

Reason: P22 services zijn dead code voor MVP (memory). Maar architectuur intact = future-proof. Wanneer OFFICIAL_RESULT auto-fetch werkt (P26+), /resolve kan upgraded naar committing endpoint.

## Files to create

```
docs/PROMPT_P23_RESOLUTION_API.md                       new
src/lib/templates/service.ts                            new
src/lib/http/serialize.ts                               edit (+ serializeTemplate)
src/app/api/templates/route.ts                          new
src/app/api/templates/[slug]/route.ts                   new
src/app/api/bets/[id]/propose-result/route.ts           new
src/app/api/bets/[id]/confirm-result/route.ts           new
src/app/api/bets/[id]/resolve/route.ts                  new
src/__tests__/http/templates-list.test.ts               new  (4 cases)
src/__tests__/http/templates-detail.test.ts             new  (3 cases)
src/__tests__/http/bets-propose-result.test.ts          new  (5 cases)
src/__tests__/http/bets-confirm-result.test.ts          new  (5 cases)
src/__tests__/http/bets-resolve.test.ts                 new  (4 cases)
```

13 files (1 spec + 1 service + 1 edit + 5 routes + 5 tests).

## Pre-flight

```bash
cd /workspaces/zentrix
git checkout wip-p23-resolution-api
git status --short    # clean
git log --oneline -3  # 998c004 P22 merge

ls -la .env   # symlink
pnpm prisma migrate status   # "Database schema is up to date"

# Check existing exports we'll use:
grep -E "^export.*function (proposeResult|confirmResult|requireCurrentUser)" src/lib/bets/service.ts src/lib/auth.ts

# Check existing route pattern:
cat src/app/api/bets/route.ts | head -50
```

## Implementation steps

### Step 0 — Write spec to docs/

Write spec naar `docs/PROMPT_P23_RESOLUTION_API.md`, commit + push.

```bash
git add docs/PROMPT_P23_RESOLUTION_API.md
git commit -m "docs(p23): resolution API endpoints spec (5 routes)"
git push origin wip-p23-resolution-api
```

PAUSE — confirm.

### Step 1 — Investigate existing patterns

```bash
# Look at proposeResult signature
grep -A 25 "export async function proposeResult" src/lib/bets/service.ts | head -40

# Look at confirmResult signature
grep -A 25 "export async function confirmResult" src/lib/bets/service.ts | head -40

# Look at BetError class
grep -A 10 "class BetError\|export class BetError" src/lib/bets/errors.ts 2>/dev/null | head -15

# Look at existing route handler pattern (bets POST)
cat src/app/api/bets/route.ts
```

Report findings. Geen code geschreven yet.

PAUSE — confirm we have the signatures right.

### Step 2 — Create src/lib/templates/service.ts

Write file uit Design decision 8.

```bash
pnpm tsc --noEmit 2>&1 | grep -E "src/lib/templates" | head -10
```

PAUSE.

### Step 3 — Update src/lib/http/serialize.ts

Add `serializeTemplate` function. Import `BetTemplate` from `@prisma/client`. Place near existing `serializeBet`.

SHOW git diff src/lib/http/serialize.ts.

PAUSE.

### Step 4 — Create src/app/api/templates/route.ts (GET list)

```typescript
import { z } from "zod";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { listTemplates } from "@/lib/templates/service";
import { serializeTemplate } from "@/lib/http/serialize";

const QuerySchema = z.object({
  category: z.string().optional(),
  settlementMethod: z.enum(["OFFICIAL_RESULT", "ORACLE_VALUE", "PLATFORM_PROOF", "THRESHOLD_METRIC"]).optional(),
  activeOnly: z.coerce.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    await requireCurrentUser();
    
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_QUERY", message: "Invalid query params", details: parsed.error.flatten() } },
        { status: 400 }
      );
    }
    
    const templates = await listTemplates(parsed.data);
    return Response.json({
      ok: true,
      data: {
        templates: templates.map(serializeTemplate),
        total: templates.length,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
    }
    console.error("[GET /api/templates]", e);
    return Response.json({ ok: false, error: { code: "INTERNAL", message: "Server error" } }, { status: 500 });
  }
}
```

PAUSE — show file.

### Step 5 — Create src/app/api/templates/[slug]/route.ts (GET detail)

```typescript
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { getTemplate } from "@/lib/templates/service";
import { serializeTemplate } from "@/lib/http/serialize";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireCurrentUser();
    
    const { slug } = await params;
    const template = await getTemplate(slug);
    
    if (!template) {
      return Response.json(
        { ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: `Template ${slug} not found` } },
        { status: 404 }
      );
    }
    
    return Response.json({ ok: true, data: { template: serializeTemplate(template) } });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
    }
    console.error("[GET /api/templates/[slug]]", e);
    return Response.json({ ok: false, error: { code: "INTERNAL", message: "Server error" } }, { status: 500 });
  }
}
```

PAUSE.

### Step 6 — Create src/app/api/bets/[id]/propose-result/route.ts

```typescript
import { z } from "zod";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { proposeResult } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";
import { serializeBet, serializeBetResultClaim } from "@/lib/http/serialize";

const BodySchema = z.object({
  claimedWinnerSide: z.enum(["A", "B"]),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser();
    const { id: betId } = await params;
    
    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_BODY", message: "Invalid body", details: parsed.error.flatten() } },
        { status: 400 }
      );
    }
    
    const result = await proposeResult({
      betId,
      userId: user.id,
      claimedWinnerSide: parsed.data.claimedWinnerSide,
      note: parsed.data.note,
    });
    
    return Response.json({
      ok: true,
      data: {
        bet: serializeBet(result.bet),
        claim: serializeBetResultClaim(result.claim),
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
    }
    if (e instanceof BetError) {
      return Response.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.statusCode });
    }
    console.error("[POST /api/bets/[id]/propose-result]", e);
    return Response.json({ ok: false, error: { code: "INTERNAL", message: "Server error" } }, { status: 500 });
  }
}
```

PAUSE.

### Step 7 — Create src/app/api/bets/[id]/confirm-result/route.ts

```typescript
import { z } from "zod";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { confirmResult } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";
import { serializeBet } from "@/lib/http/serialize";

const BodySchema = z.object({
  confirmation: z.enum(["AGREE", "DISPUTE"]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser();
    const { id: betId } = await params;
    
    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_BODY", message: "Invalid body", details: parsed.error.flatten() } },
        { status: 400 }
      );
    }
    
    // DISPUTE flow is separate (P13) — returns placeholder error for MVP
    if (parsed.data.confirmation === "DISPUTE") {
      return Response.json(
        { ok: false, error: { code: "DISPUTE_REQUIRED", message: "Use /api/disputes endpoint to open dispute (not yet exposed via API)" } },
        { status: 400 }
      );
    }
    
    const result = await confirmResult({
      betId,
      userId: user.id,
    });
    
    return Response.json({
      ok: true,
      data: { bet: serializeBet(result.bet) },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
    }
    if (e instanceof BetError) {
      return Response.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.statusCode });
    }
    console.error("[POST /api/bets/[id]/confirm-result]", e);
    return Response.json({ ok: false, error: { code: "INTERNAL", message: "Server error" } }, { status: 500 });
  }
}
```

PAUSE.

### Step 8 — Create src/app/api/bets/[id]/resolve/route.ts

```typescript
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { resolveBet } from "@/lib/settlement/router";
import { SettlementError } from "@/lib/settlement/types";

const BodySchema = z.object({
  method: z.enum(["OFFICIAL_RESULT", "ORACLE_VALUE", "PLATFORM_PROOF", "THRESHOLD_METRIC"]),
  proof: z.unknown(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser();
    const { id: betId } = await params;
    
    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_BODY", message: "Invalid body", details: parsed.error.flatten() } },
        { status: 400 }
      );
    }
    
    // Load bet + ensure user is participant
    const bet = await prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) {
      return Response.json({ ok: false, error: { code: "BET_NOT_FOUND", message: "Bet not found" } }, { status: 404 });
    }
    if (bet.createdById !== user.id && bet.opponentUserId !== user.id) {
      return Response.json({ ok: false, error: { code: "NOT_PARTICIPANT", message: "Only participants can resolve" } }, { status: 403 });
    }
    
    // For MVP: template is optional context. Pass minimal template shape if no betTemplateId yet.
    const template = {
      slug: "stub",
      settlementMethod: parsed.data.method,
      allowedSources: [],
    };
    
    const result = await resolveBet({
      betId,
      template,
      proof: parsed.data.proof,
      initiatorUserId: user.id,
    });
    
    // KRITIEK: This does NOT commit settlement. Returns DECISION only.
    // Frontend should use /propose-result + /confirm-result to commit.
    return Response.json({
      ok: true,
      data: {
        decision: {
          winnerSide: result.winnerSide,
          resolvedAt: result.resolvedAt.toISOString(),
          evidence: result.evidence,
          method: result.method,
        },
        note: "This endpoint returns the resolution decision only. Use /propose-result + /confirm-result to commit.",
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
    }
    if (e instanceof SettlementError) {
      return Response.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.statusCode });
    }
    console.error("[POST /api/bets/[id]/resolve]", e);
    return Response.json({ ok: false, error: { code: "INTERNAL", message: "Server error" } }, { status: 500 });
  }
}
```

PAUSE — show file.

### Step 9 — TypeScript verify

```bash
pnpm tsc --noEmit 2>&1 | grep -E "src/(lib/(templates|http)|app/api/(templates|bets))" | head -20
```

MUST be 0 errors. Pre-existing errors elders = OK.

PAUSE.

### Step 10 — Create 5 test files

Each test file mocks dependencies (prisma, auth, services) and tests the route handler logic:

```
src/__tests__/http/templates-list.test.ts        (4 cases: happy, auth fail, filter, empty)
src/__tests__/http/templates-detail.test.ts      (3 cases: happy, 404, auth fail)
src/__tests__/http/bets-propose-result.test.ts   (5 cases: happy, auth fail, invalid body, BetError mapping, non-participant)
src/__tests__/http/bets-confirm-result.test.ts   (5 cases: happy, auth fail, DISPUTE placeholder, BetError mapping, invalid body)
src/__tests__/http/bets-resolve.test.ts          (4 cases: happy, auth fail, non-participant, SettlementError mapping)
```

Pattern: copy from existing `src/__tests__/http/bets-create-labels.test.ts` (P19).

```typescript
// Example: templates-list.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/templates/service", () => ({
  listTemplates: vi.fn(),
}));

import { GET } from "@/app/api/templates/route";
import { requireCurrentUser } from "@/lib/auth";
import { listTemplates } from "@/lib/templates/service";

describe("GET /api/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path returns templates", async () => {
    (requireCurrentUser as any).mockResolvedValue({ id: "user-1" });
    (listTemplates as any).mockResolvedValue([
      { id: "1", slug: "test", name: "Test", category: "Sport", /* ... */ createdAt: new Date(), updatedAt: new Date() },
    ]);
    
    const req = new Request("https://example.com/api/templates");
    const res = await GET(req);
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(1);
  });

  // ... other cases
});
```

DO NOT run `pnpm test` (productie DB discipline).

PAUSE — show test files.

### Step 11 — Final TypeScript verify

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

MUST be `Found 0 errors`.

PAUSE.

### Step 12 — Commit + push

```bash
git status --short
# Expected:
# A  docs/PROMPT_P23_RESOLUTION_API.md  (already in Step 0)
# A  src/lib/templates/service.ts
# M  src/lib/http/serialize.ts
# A  src/app/api/templates/route.ts
# A  src/app/api/templates/[slug]/route.ts
# A  src/app/api/bets/[id]/propose-result/route.ts
# A  src/app/api/bets/[id]/confirm-result/route.ts
# A  src/app/api/bets/[id]/resolve/route.ts
# A  src/__tests__/http/templates-list.test.ts
# A  src/__tests__/http/templates-detail.test.ts
# A  src/__tests__/http/bets-propose-result.test.ts
# A  src/__tests__/http/bets-confirm-result.test.ts
# A  src/__tests__/http/bets-resolve.test.ts

git add src/lib/templates/service.ts \
        src/lib/http/serialize.ts \
        src/app/api/templates/ \
        src/app/api/bets/ \
        src/__tests__/http/

git commit -m "feat(p23): resolution API endpoints (5 routes)

Adds HTTP API on top of P20-P22 settlement architecture.

Endpoints:
- GET /api/templates                       list 15 templates (filter on category, settlementMethod)
- GET /api/templates/[slug]                template detail
- POST /api/bets/[id]/propose-result       wraps proposeResult service
- POST /api/bets/[id]/confirm-result       wraps confirmResult service
- POST /api/bets/[id]/resolve              facade: calls router.resolveBet (P22), returns DECISION only

Implementation:
- src/lib/templates/service.ts: listTemplates + getTemplate
- src/lib/http/serialize.ts: serializeTemplate function
- All routes use requireCurrentUser auth, Zod body validation, BetError/SettlementError mapping

Design decisions:
- /resolve returns DECISION only (no DB write) — preserves P22 loose coupling
- For MVP: frontend uses /propose-result + /confirm-result to commit settlement
- /resolve is future-proof for OFFICIAL_RESULT auto-resolve (P26+)
- DISPUTE confirmation returns placeholder error (P13 service exists, API later)
- No service.ts changes (loose coupling preserved)

Tests (5 files, ~21 cases total):
- templates-list.test.ts (4 cases)
- templates-detail.test.ts (3 cases)
- bets-propose-result.test.ts (5 cases)
- bets-confirm-result.test.ts (5 cases)
- bets-resolve.test.ts (4 cases)

Tests not run locally (DATABASE_URL = production Neon).
TypeScript: 0 errors, no regressions.

Out of scope:
- Admin endpoints (templates CRUD)
- Cancel-bet endpoint (P15 cron handles expire)
- Dispute API endpoints (P13 service exists, separate prompt)
- Working OFFICIAL_RESULT auto-fetch (P22 stub maintained)
- Frontend (P24-P25)"

git push origin wip-p23-resolution-api
git log --oneline -3
```

PAUSE — confirm hash + push.

### Step 13 — Open PR

```bash
gh pr create \
  --base main \
  --head wip-p23-resolution-api \
  --title "P23: Resolution API endpoints (5 routes)" \
  --body "$(cat <<'EOF'
HTTP API on top of P20-P22 settlement architecture.

## Endpoints (5)
- GET /api/templates                      List 15 templates (filter on category, settlementMethod)
- GET /api/templates/[slug]               Template detail
- POST /api/bets/[id]/propose-result      Wraps proposeResult service
- POST /api/bets/[id]/confirm-result      Wraps confirmResult service
- POST /api/bets/[id]/resolve             Facade: calls router.resolveBet (P22), returns DECISION only

## Wager pattern alignment
- Endpoint URLs follow Wager v2 conventie (submit-proof → propose-result, confirm)
- Did NOT port Wager v2 complexity (30+ tests, workers, oracle endpoints — out of scope)
- Zentrix backend already cleaner than Wager pattern needed

## Design
- /resolve returns DECISION only (no DB write) — preserves P22 loose coupling
- Frontend uses /propose-result + /confirm-result to commit settlement
- /resolve future-proof for OFFICIAL_RESULT auto-resolve (P26+)
- DISPUTE confirmation returns placeholder (P13 service exists, API later)
- No service.ts changes (loose coupling maintained)

## Validation
- ~21 unit tests across 5 routes
- All routes use requireCurrentUser auth + Zod body validation
- TypeScript clean (0 errors)

## Migration safety
- No schema changes
- No new dependencies
- Existing services (proposeResult, confirmResult) unchanged
- Tests not run locally (DATABASE_URL = production)

## Roadmap
- P20 ✅ Schema foundation
- P21 ✅ Templates seed (15 LIVE)
- P22 ✅ Settlement methods architecture
- **P23 (this PR)** Resolution API endpoints
- P24 — Frontend wizard architecture
- P25 — Frontend create-bet wizard

## Out of scope
- Admin endpoints
- Cancel-bet endpoint
- Dispute API endpoints
- Working OFFICIAL_RESULT auto-fetch
- Frontend (P24-P25)
EOF
)"
```

Report PR URL. DO NOT merge.

## Acceptance criteria

- [ ] `docs/PROMPT_P23_RESOLUTION_API.md` committed
- [ ] 5 route handler files in `src/app/api/`
- [ ] `src/lib/templates/service.ts` created
- [ ] `src/lib/http/serialize.ts` has `serializeTemplate`
- [ ] 5 test files in `src/__tests__/http/` (~21 cases)
- [ ] `pnpm tsc --noEmit` clean (0 errors)
- [ ] PR opened
- [ ] Vercel CI green

## Stop conditions

- TypeScript errors in non-P23 files → STOP regression
- Wijziging aan `src/lib/bets/service.ts` → STOP (loose coupling)
- Wijziging aan `src/lib/settlement/` (P22 code) → STOP (loose coupling)
- pnpm test attempted → STOP
- Service signatures verschillen van pre-flight findings (Step 1) → STOP, diagnose
- BetError class niet vinden → STOP, locate

## Adversarial review

| Aanval | Verdediging |
|---|---|
| /resolve endpoint commits settlement | Returns DECISION only, expliciet in response note |
| Frontend gebruikt /resolve voor commit | Endpoint response zegt "use /propose-result + /confirm-result to commit" |
| Race condition op propose-result | Service heeft state machine guards (existing behavior) |
| Auth bypass via spoofed cookie | requireCurrentUser uses Privy session validation (existing) |
| Zod validation circumvented | Body parsed via safeParse, returns 400 on fail |
| BetError class missing export | Pre-flight Step 1 verifies (will fail there if missing) |
| `params: Promise<...>` Next.js 15 syntax | Next.js App Router v15+ pattern (already used in /api/bets/[id]) |
| Template service queries soft-deleted | `deletedAt: null` filter enforced |
| Templates list large response | Only 15 templates, no pagination needed |
| /resolve passes stub template to router | OK for MVP — P22 services accept generic template shape |

## Notes for executor

1. **DO NOT** modify `src/lib/bets/service.ts` — loose coupling
2. **DO NOT** modify `src/lib/settlement/*` — P22 code unchanged
3. **DO NOT** run `pnpm test` — productie DB
4. **Pre-flight Step 1** is verplicht — bevestig service signatures
5. Pre-existing Prisma deprecation warning — negeer
6. Next.js App Router v15 syntax: `params: Promise<{ slug: string }>` then `const { slug } = await params`
7. BetError class location: probably `src/lib/bets/errors.ts` (verify in Step 1)

## Tempo schatting

```
Step 0 spec commit:        5 min
Step 1 investigation:      10 min
Step 2 template service:   10 min
Step 3 serialize update:   5 min
Step 4 templates GET:      10 min
Step 5 templates detail:   5 min
Step 6 propose-result:     15 min
Step 7 confirm-result:     15 min
Step 8 resolve facade:     20 min
Step 9 tsc check:          5 min
Step 10 5 test files:      30 min
Step 11 final tsc:         5 min
Step 12 commit + push:     5 min
Step 13 PR open:           5 min
─────────────────────────
TOTAL:                     ~2.5 hours
```

## Next steps after P23 merge

- P24 spec: Frontend wizard architecture
- Frontend uses /api/templates to populate template picker
- Frontend uses /api/bets/[id]/propose-result + /confirm-result for settlement
- /api/bets/[id]/resolve unused for MVP (future-proof endpoint)
- Estimate: 3-4 hours spec, then P25 implementation

Niet starten zonder explicit go signal voor P24.
