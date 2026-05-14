# PROMPT_P24 — Frontend create-bet page (template picker + form)

**Status:** Spec — execution prompt voor P25 implementation.

## Context

P23 LIVE op productie (commit 56428c4). Backend Wager P2P architecture compleet:
- ✅ P19 — Bet labels (title/outcomeA/outcomeB)
- ✅ P20 — BetTemplate schema
- ✅ P21 — 15 templates seeded (Sport×4, Combat×3, Esports×4, Games×4)
- ✅ P22 — SettlementMethod enum + 4 method services
- ✅ P23 — Resolution API (GET /api/templates, /api/templates/[slug], POST /api/bets/[id]/resolve)
- ✅ P16 — createBet POST /api/bets, proposeResult, confirmResult routes

P24/P25 = frontend wizard architecture + create-bet implementation:
- **P24** — Spec voor frontend create-bet page (deze prompt)
- **P25** — Implementation per spec

## Scope strategy — Optie β + α architectuur

**Layer 1 (P25 implementation NU):** Single-page `/bets/new` met 4 secties op 1 scroll.
**Layer 2 (Future-ready architectuur):** Component boundaries + Context provider opgezet zodat P26+ trivial naar multi-page wizard splitsen kan.

```
SINGLE-PAGE LAYOUT (Layer 1):
┌─────────────────────────────────────────────────┐
│ /bets/new                                       │
├─────────────────────────────────────────────────┤
│ Section 1: Template Picker (always visible)    │
│   [15 cards in grid, filter by category]       │
├─────────────────────────────────────────────────┤
│ Section 2: Bet Form (after template selected)  │
│   Pre-filled from template:                    │
│   - title (editable)                           │
│   - outcomeA (editable)                        │
│   - outcomeB (editable)                        │
│   User input:                                  │
│   - side (A or B)                              │
│   - stakeUnits                                 │
│   - expiresInHours                             │
├─────────────────────────────────────────────────┤
│ Section 3: Review (after form complete)        │
│   [Summary card with all values]               │
├─────────────────────────────────────────────────┤
│ Section 4: Submit Button                       │
│   [Create Bet] → POST /api/bets                │
└─────────────────────────────────────────────────┘
```

**FUTURE EVOLUTION (Layer 2 architectuur, niet activated):**
- Context provider already established → can wrap whole wizard
- LocalStorage hook for state persistence → just enable
- Component boundaries clean → routes /bets/new/template, /bets/new/form, /bets/new/review trivial

## Scope

### In scope (P25 implementation)

- Page: `src/app/(app)/bets/new/page.tsx`
- Components: TemplateGrid, TemplateCard, BetForm, BetReview, SubmitBetButton
- Hooks: useTemplates, useCreateBet, useCreateBetState (Context)
- API client wrapper: `src/lib/api/client.ts` (fills gap — no fetcher yet)
- Type definitions: `src/lib/api/types.ts` (re-export serialize types)
- Page-level loading + error states (Suspense + ErrorBoundary)
- Sonner toasts voor errors
- Mobile-responsive (Tailwind grid)
- Auth guard (redirect unauthenticated → /signin)
- Idempotency-Key generation (UUIDv4 client-side)

### Out of scope

- 4-step wizard navigation (Layer 1 = single page)
- LocalStorage state persistence (Layer 2 hook present but disabled)
- React-hook-form (use native useState — geen extra dep)
- Multi-page wizard routes (Layer 2 future)
- Settlement UI / dispute UI (P26+)
- Wallet balance check before submit (P26+)
- Pool-attached bets (P25 = peer-to-peer only, geen poolId)
- Match-attached bets (geen matchId in P25 form)
- Bet preview voor opponents (separate page)
- Optimistic UI updates (use TanStack Query default cache)

## Design decisions

### 1. Stack — alle deps al beschikbaar

```
@tanstack/react-query@5.100  ✅ installed
sonner@2.0                   ✅ installed
shadcn/ui primitives         ✅ button, card, input, select, alert, badge, separator, skeleton, sonner
Privy auth                   ✅ via use-current-user hook
Zod                          ✅ already in package.json (server-side)
```

**Geen nieuwe dependencies in P25.** React-hook-form expliciet vermeden.

### 2. API client wrapper

Gap: geen fetcher yet. Create `src/lib/api/client.ts`:

```typescript
// src/lib/api/client.ts

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly issues?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestInit = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }
  
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    credentials: "include", // Privy cookie session
  });
  
  if (!res.ok) {
    let errorBody: any = {};
    try { errorBody = await res.json(); } catch {}
    throw new ApiError(
      errorBody.error ?? "unknown_error",
      errorBody.message ?? res.statusText,
      res.status,
      errorBody.issues
    );
  }
  
  return res.json();
}
```

### 3. Idempotency-Key generation client-side

```typescript
// src/lib/api/idempotency.ts

export function generateIdempotencyKey(): string {
  // Uses native crypto.randomUUID() - available in all modern browsers + Node 19+
  return crypto.randomUUID();
}
```

Used in `useCreateBet` mutation — generated once per submit attempt, passed to apiRequest.

### 4. useTemplates hook

```typescript
// src/hooks/use-templates.ts

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";
import type { SerializedTemplate } from "@/lib/api/types";

type TemplatesResponse = {
  templates: SerializedTemplate[];
  total: number;
};

export function useTemplates(filter?: { category?: string; settlementMethod?: string }) {
  const params = new URLSearchParams();
  if (filter?.category) params.set("category", filter.category);
  if (filter?.settlementMethod) params.set("settlementMethod", filter.settlementMethod);
  const queryString = params.toString();
  
  return useQuery({
    queryKey: ["templates", filter],
    queryFn: () => apiRequest<TemplatesResponse>(`/api/templates${queryString ? `?${queryString}` : ""}`),
    staleTime: 5 * 60 * 1000, // 5 min — templates rarely change
  });
}
```

### 5. useCreateBet mutation

```typescript
// src/hooks/use-create-bet.ts

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";
import { generateIdempotencyKey } from "@/lib/api/idempotency";
import type { CreateBetInput, CreateBetResponse } from "@/lib/api/types";

export function useCreateBet() {
  const qc = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateBetInput) => {
      return apiRequest<CreateBetResponse>("/api/bets", {
        method: "POST",
        body: input,
        idempotencyKey: generateIdempotencyKey(),
      });
    },
    onSuccess: () => {
      // Invalidate bet lists so /feed refreshes
      qc.invalidateQueries({ queryKey: ["bets"] });
    },
  });
}
```

### 6. Context — Layer 2 architectuur (opgezet maar minimaal)

```typescript
// src/components/bets/create-bet-context.tsx
"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import type { SerializedTemplate } from "@/lib/api/types";

type CreateBetState = {
  template: SerializedTemplate | null;
  setTemplate: (t: SerializedTemplate | null) => void;
  
  // Form fields
  title: string;
  setTitle: (s: string) => void;
  outcomeA: string;
  setOutcomeA: (s: string) => void;
  outcomeB: string;
  setOutcomeB: (s: string) => void;
  side: "A" | "B";
  setSide: (s: "A" | "B") => void;
  stakeUnits: string;
  setStakeUnits: (s: string) => void;
  expiresInHours: number;
  setExpiresInHours: (n: number) => void;
  
  // Helpers
  reset: () => void;
};

const CreateBetContext = createContext<CreateBetState | null>(null);

export function CreateBetProvider({ children }: { children: ReactNode }) {
  const [template, setTemplate] = useState<SerializedTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [outcomeA, setOutcomeA] = useState("");
  const [outcomeB, setOutcomeB] = useState("");
  const [side, setSide] = useState<"A" | "B">("A");
  const [stakeUnits, setStakeUnits] = useState("");
  const [expiresInHours, setExpiresInHours] = useState(24);
  
  // Auto-populate form when template selected
  const handleSetTemplate = (t: SerializedTemplate | null) => {
    setTemplate(t);
    if (t) {
      setTitle(t.name);
      // outcomeA/outcomeB defaults from template's outcomeType if applicable
      // For WINNER type: leave empty, user fills in (e.g. "Team A wins" / "Team B wins")
    }
  };
  
  const reset = () => {
    setTemplate(null);
    setTitle("");
    setOutcomeA("");
    setOutcomeB("");
    setSide("A");
    setStakeUnits("");
    setExpiresInHours(24);
  };
  
  return (
    <CreateBetContext.Provider
      value={{
        template, setTemplate: handleSetTemplate,
        title, setTitle,
        outcomeA, setOutcomeA,
        outcomeB, setOutcomeB,
        side, setSide,
        stakeUnits, setStakeUnits,
        expiresInHours, setExpiresInHours,
        reset,
      }}
    >
      {children}
    </CreateBetContext.Provider>
  );
}

export function useCreateBetState() {
  const ctx = useContext(CreateBetContext);
  if (!ctx) throw new Error("useCreateBetState must be inside CreateBetProvider");
  return ctx;
}
```

**Layer 2 readiness:** Whole wizard state in one provider. P26+ kan dit wrappen rond multi-page wizard via Next.js route group `/(wizard)/...`.

### 7. Page composition

```typescript
// src/app/(app)/bets/new/page.tsx

import { CreateBetPage } from "@/components/bets/create-bet-page";

export const metadata = {
  title: "Create Bet | Zentrix",
};

export default function NewBetPage() {
  return <CreateBetPage />;
}
```

```typescript
// src/components/bets/create-bet-page.tsx
"use client";

import { CreateBetProvider } from "./create-bet-context";
import { TemplateGrid } from "@/components/templates/template-grid";
import { BetForm } from "./bet-form";
import { BetReview } from "./bet-review";
import { SubmitBetButton } from "./submit-bet-button";

export function CreateBetPage() {
  return (
    <CreateBetProvider>
      <div className="container mx-auto py-8 space-y-8 max-w-4xl">
        <header>
          <h1 className="text-3xl font-bold">Create a Bet</h1>
          <p className="text-muted-foreground">Pick a template, fill in the details, and challenge an opponent.</p>
        </header>
        
        <section aria-labelledby="template-heading">
          <h2 id="template-heading" className="text-xl font-semibold mb-4">1. Pick a template</h2>
          <TemplateGrid />
        </section>
        
        <section aria-labelledby="form-heading">
          <h2 id="form-heading" className="text-xl font-semibold mb-4">2. Bet details</h2>
          <BetForm />
        </section>
        
        <section aria-labelledby="review-heading">
          <h2 id="review-heading" className="text-xl font-semibold mb-4">3. Review</h2>
          <BetReview />
        </section>
        
        <section>
          <SubmitBetButton />
        </section>
      </div>
    </CreateBetProvider>
  );
}
```

### 8. TemplateGrid + TemplateCard

```typescript
// src/components/templates/template-grid.tsx
"use client";

import { useState } from "react";
import { useTemplates } from "@/hooks/use-templates";
import { TemplateCard } from "./template-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useCreateBetState } from "@/components/bets/create-bet-context";

const CATEGORIES = ["All", "Sport", "Combat", "Esports", "Games"];

export function TemplateGrid() {
  const [category, setCategory] = useState<string>("All");
  const filter = category === "All" ? undefined : { category };
  const { data, isLoading, isError, error } = useTemplates(filter);
  const { template: selected } = useCreateBetState();
  
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <Badge
            key={c}
            variant={category === c ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setCategory(c)}
          >
            {c}
          </Badge>
        ))}
      </div>
      
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      )}
      
      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load templates: {error.message}</AlertDescription>
        </Alert>
      )}
      
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={selected?.id === t.id}
            />
          ))}
        </div>
      )}
      
      {data && data.templates.length === 0 && (
        <Alert>
          <AlertDescription>No templates match this filter.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
```

```typescript
// src/components/templates/template-card.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCreateBetState } from "@/components/bets/create-bet-context";
import type { SerializedTemplate } from "@/lib/api/types";

export function TemplateCard({ template, selected }: { template: SerializedTemplate; selected: boolean }) {
  const { setTemplate } = useCreateBetState();
  
  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${selected ? "ring-2 ring-primary" : ""}`}
      onClick={() => setTemplate(template)}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{template.name}</CardTitle>
          <Badge variant="outline" className="shrink-0">{template.category}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2">{template.resolutionRule}</p>
      </CardContent>
    </Card>
  );
}
```

### 9. BetForm component

```typescript
// src/components/bets/bet-form.tsx
"use client";

import { useCreateBetState } from "./create-bet-context";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const HOUR_PRESETS = [
  { value: 24, label: "24 hours" },
  { value: 48, label: "2 days" },
  { value: 72, label: "3 days" },
  { value: 168, label: "1 week" },
];

export function BetForm() {
  const state = useCreateBetState();
  
  if (!state.template) {
    return (
      <Alert>
        <AlertDescription>Pick a template above to start filling in your bet.</AlertDescription>
      </Alert>
    );
  }
  
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {/* Title */}
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium">Title</label>
          <Input
            id="title"
            value={state.title}
            onChange={(e) => state.setTitle(e.target.value)}
            placeholder="e.g. Real Madrid vs Barcelona"
            maxLength={200}
          />
        </div>
        
        {/* Outcomes A and B */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="outcomeA" className="text-sm font-medium">Outcome A</label>
            <Input
              id="outcomeA"
              value={state.outcomeA}
              onChange={(e) => state.setOutcomeA(e.target.value)}
              placeholder="e.g. Real Madrid wins"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="outcomeB" className="text-sm font-medium">Outcome B</label>
            <Input
              id="outcomeB"
              value={state.outcomeB}
              onChange={(e) => state.setOutcomeB(e.target.value)}
              placeholder="e.g. Barcelona wins"
              maxLength={100}
            />
          </div>
        </div>
        
        {/* Side selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Your side</label>
          <div className="flex gap-2">
            <Button
              variant={state.side === "A" ? "default" : "outline"}
              onClick={() => state.setSide("A")}
              className="flex-1"
            >
              A: {state.outcomeA || "Outcome A"}
            </Button>
            <Button
              variant={state.side === "B" ? "default" : "outline"}
              onClick={() => state.setSide("B")}
              className="flex-1"
            >
              B: {state.outcomeB || "Outcome B"}
            </Button>
          </div>
        </div>
        
        {/* Stake */}
        <div className="space-y-2">
          <label htmlFor="stake" className="text-sm font-medium">Stake (USDC)</label>
          <Input
            id="stake"
            type="number"
            min="1"
            step="0.01"
            value={state.stakeUnits}
            onChange={(e) => state.setStakeUnits(e.target.value)}
            placeholder="25.00"
          />
          <p className="text-xs text-muted-foreground">Both sides stake the same amount. Winner takes the pot.</p>
        </div>
        
        {/* Expires */}
        <div className="space-y-2">
          <label htmlFor="expires" className="text-sm font-medium">Expires in</label>
          <Select
            value={String(state.expiresInHours)}
            onValueChange={(v) => state.setExpiresInHours(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOUR_PRESETS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">If no one accepts within this time, the bet expires.</p>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 10. BetReview component

```typescript
// src/components/bets/bet-review.tsx
"use client";

import { useCreateBetState } from "./create-bet-context";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function BetReview() {
  const state = useCreateBetState();
  
  const isFormComplete = Boolean(
    state.template && state.title && state.outcomeA && state.outcomeB && state.stakeUnits
  );
  
  if (!isFormComplete) {
    return (
      <Alert>
        <AlertDescription>Fill in all fields above to see your bet preview.</AlertDescription>
      </Alert>
    );
  }
  
  const expiresLabel = state.expiresInHours >= 24
    ? `${state.expiresInHours / 24} day${state.expiresInHours / 24 > 1 ? "s" : ""}`
    : `${state.expiresInHours} hours`;
  
  return (
    <Card>
      <CardContent className="pt-6 space-y-3 text-sm">
        <div><strong>Template:</strong> {state.template?.name}</div>
        <div><strong>Title:</strong> {state.title}</div>
        <div><strong>Outcome A:</strong> {state.outcomeA}</div>
        <div><strong>Outcome B:</strong> {state.outcomeB}</div>
        <div><strong>Your side:</strong> {state.side} ({state.side === "A" ? state.outcomeA : state.outcomeB})</div>
        <div><strong>Stake:</strong> {state.stakeUnits} USDC</div>
        <div><strong>Expires in:</strong> {expiresLabel}</div>
      </CardContent>
    </Card>
  );
}
```

### 11. SubmitBetButton component

```typescript
// src/components/bets/submit-bet-button.tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCreateBetState } from "./create-bet-context";
import { useCreateBet } from "@/hooks/use-create-bet";
import { ApiError } from "@/lib/api/client";

export function SubmitBetButton() {
  const router = useRouter();
  const state = useCreateBetState();
  const { mutate, isPending } = useCreateBet();
  
  const isComplete = Boolean(
    state.template && state.title && state.outcomeA && state.outcomeB && state.stakeUnits
  );
  
  const stakeNum = Number(state.stakeUnits);
  const isValidStake = !isNaN(stakeNum) && stakeNum >= 1;
  const canSubmit = isComplete && isValidStake && !isPending;
  
  const handleSubmit = () => {
    if (!canSubmit) return;
    
    // Convert human USDC to micro-units (×1,000,000) as decimal string
    const stakeMicroUnits = String(BigInt(Math.round(stakeNum * 1_000_000)));
    
    mutate(
      {
        title: state.title,
        outcomeA: state.outcomeA,
        outcomeB: state.outcomeB,
        side: state.side,
        stakeUnits: stakeMicroUnits,
        expiresInHours: state.expiresInHours,
      },
      {
        onSuccess: (data) => {
          toast.success("Bet created");
          state.reset();
          router.push(`/bets/${data.bet.id}`);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.code === "bad_body") {
              toast.error("Invalid input. Check your form fields.");
            } else if (err.status === 401) {
              toast.error("Please sign in.");
              router.push("/signin");
            } else {
              toast.error(err.message);
            }
          } else {
            toast.error("Failed to create bet. Please try again.");
          }
        },
      }
    );
  };
  
  return (
    <div className="flex justify-end gap-2">
      <Button
        variant="ghost"
        onClick={() => state.reset()}
        disabled={isPending}
      >
        Reset
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        size="lg"
      >
        {isPending ? "Creating..." : "Create Bet"}
      </Button>
    </div>
  );
}
```

### 12. API types

```typescript
// src/lib/api/types.ts

// These mirror src/lib/http/serialize.ts output shapes.
// In future: generate from server types via zod or shared package.

export type SerializedTemplate = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  settlementType: "BINARY" | "THRESHOLD";
  settlementMethod: "OFFICIAL_RESULT" | "ORACLE_VALUE" | "PLATFORM_PROOF" | "THRESHOLD_METRIC";
  outcomeType: string;
  fieldsSchema: unknown;
  allowedSources: unknown;
  resolutionRule: string;
  supportsAutoResolve: boolean;
  requiresOfficialEvent: boolean;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SerializedBet = {
  id: string;
  status: string;
  title: string;
  createdById: string;
  opponentUserId: string | null;
  creatorSide: "A" | "B";
  acceptorSide: "A" | "B" | null;
  outcomeA: string;
  outcomeB: string;
  // ... other fields per server serialize
};

export type CreateBetInput = {
  side: "A" | "B";
  stakeUnits: string;       // micro-USDC as decimal string
  expiresInHours: number;
  title: string;
  outcomeA: string;
  outcomeB: string;
  poolId?: string;          // not used in P25
  matchId?: string;         // not used in P25
};

export type CreateBetResponse = {
  bet: SerializedBet;
  // ... other fields per server response
};
```

### 13. Auth guard

`/app/(app)/` route group should already have `<auth-guard>` from P18. Verify in pre-flight Step 1.

If not present: page-level redirect to /signin on unauthenticated state.

## Files to create

```
docs/PROMPT_P24_CREATE_BET_PAGE.md                      new  spec
src/app/(app)/bets/new/page.tsx                         new  page entry
src/components/bets/create-bet-page.tsx                 new  composition
src/components/bets/create-bet-context.tsx              new  Layer 2 context
src/components/bets/bet-form.tsx                        new  form section
src/components/bets/bet-review.tsx                      new  review section
src/components/bets/submit-bet-button.tsx               new  submit handler
src/components/templates/template-grid.tsx              new  grid + filter
src/components/templates/template-card.tsx              new  single card
src/hooks/use-templates.ts                              new  TanStack query
src/hooks/use-create-bet.ts                             new  TanStack mutation
src/lib/api/client.ts                                   new  fetch wrapper
src/lib/api/idempotency.ts                              new  UUID gen
src/lib/api/types.ts                                    new  shared types

14 files. ~700 lines total productive code.
```

## Pre-flight

```bash
cd /workspaces/zentrix
git checkout main
git pull origin main
git checkout -b wip-p24-create-bet-page
git status --short

# Verify existing frontend deps
grep -E "@tanstack/react-query|sonner|@radix-ui" package.json | head -10

# Verify shadcn primitives
ls src/components/ui/

# Verify Privy provider + use-current-user
grep -l "usePrivy\|PrivyProvider" src/app/ src/components/ 2>/dev/null | head -5

# Verify (app) route group + auth guard
ls src/app/\(app\)/ 2>/dev/null
cat src/app/\(app\)/layout.tsx 2>/dev/null

# Verify createBet route body shape one more time
grep -A 15 "const Body = z.object" src/app/api/bets/route.ts

# Verify QueryClient provider exists (TanStack setup from P18)
grep -rn "QueryClientProvider" src/app/ src/components/ 2>/dev/null | head -3
```

## Implementation steps

### Step 0 — Write spec to docs/

```bash
git add docs/PROMPT_P24_CREATE_BET_PAGE.md
git commit -m "docs(p24): create-bet page spec (single-page Layer 1 + wizard-ready Layer 2)"
git push origin wip-p24-create-bet-page
```

PAUSE.

### Step 1 — Pre-flight investigation

Run pre-flight commands. Report:
- TanStack QueryClient setup present? (provider in layout?)
- (app) route group + auth guard structure?
- Existing client component patterns (any "use client" with similar setup)?
- Sonner Toaster mounted?
- Sample bet-card or bet-list to mirror styling

Report findings. Geen code yet.

PAUSE.

**Stop conditions Step 1:**
- TanStack QueryClient NOT setup → SCOPE EXPAND: add provider setup
- (app) route group NOT exist → use src/app/bets/new/page.tsx instead
- Sonner Toaster NOT mounted → add to root layout

### Step 2 — API client + types + idempotency

Create:
- src/lib/api/client.ts
- src/lib/api/idempotency.ts
- src/lib/api/types.ts

```bash
mkdir -p src/lib/api
```

Write files per Design decisions 2, 3, 12.

Verify:
```bash
pnpm tsc --noEmit 2>&1 | grep -E "src/lib/api" | head -10
```

PAUSE.

### Step 3 — Hooks (useTemplates + useCreateBet)

```bash
ls src/hooks/  # should exist from P18
```

Write per Design decisions 4 + 5.

Verify tsc clean.

PAUSE.

### Step 4 — Context provider (Layer 2)

Write `src/components/bets/create-bet-context.tsx` per Design decision 6.

```bash
mkdir -p src/components/bets src/components/templates
```

Verify tsc clean.

PAUSE.

### Step 5 — Template components

Write:
- src/components/templates/template-card.tsx
- src/components/templates/template-grid.tsx

Per Design decision 8.

PAUSE.

### Step 6 — Bet form components

Write:
- src/components/bets/bet-form.tsx
- src/components/bets/bet-review.tsx
- src/components/bets/submit-bet-button.tsx

Per Design decisions 9, 10, 11.

PAUSE.

### Step 7 — Page composition

Write:
- src/app/(app)/bets/new/page.tsx
- src/components/bets/create-bet-page.tsx

Per Design decision 7.

If (app) route group not exist (Step 1 finding), use `src/app/bets/new/page.tsx`.

Verify:
```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

PAUSE.

### Step 8 — Local dev verify (NO production tests)

```bash
# Start dev server briefly to verify build
pnpm next build 2>&1 | tail -20
```

Expected: Build succeeds. New route `/bets/new` listed in build output.

**DO NOT run `pnpm test`** (productie DB).
**DO NOT run `pnpm dev` interactively** (timeout in shell).

If build fails:
- Type errors → fix per error message
- Missing deps → STOP, report (shouldn't happen, all deps installed)
- Route conflict → diagnose

PAUSE.

### Step 9 — Commit + push

```bash
git status --short
git add src/lib/api/ src/hooks/ src/components/ src/app/

git commit -m "$(cat <<'EOF'
feat(p25): create-bet page with template picker + form

Single-page /bets/new (Layer 1) with future-ready wizard architecture (Layer 2).

UI:
- /bets/new page with 4 sections on single scroll
- Section 1: Template picker (15 templates, filter by category)
- Section 2: Bet form (pre-filled from template, user fills stake/side/expires)
- Section 3: Review preview (summary card, auto-shown when complete)
- Section 4: Submit button (POST /api/bets via TanStack mutation)

Components (14 files, ~700 lines):
- src/app/(app)/bets/new/page.tsx — page entry
- src/components/bets/create-bet-page.tsx — composition
- src/components/bets/create-bet-context.tsx — wizard state Provider (Layer 2)
- src/components/bets/bet-form.tsx — form section
- src/components/bets/bet-review.tsx — review section
- src/components/bets/submit-bet-button.tsx — submit handler
- src/components/templates/template-grid.tsx — grid + filter
- src/components/templates/template-card.tsx — single card
- src/hooks/use-templates.ts — TanStack query GET /api/templates
- src/hooks/use-create-bet.ts — TanStack mutation POST /api/bets
- src/lib/api/client.ts — fetch wrapper with ApiError class
- src/lib/api/idempotency.ts — crypto.randomUUID() for Idempotency-Key
- src/lib/api/types.ts — shared serialized types

Stack:
- @tanstack/react-query (already installed)
- sonner toasts (already installed)
- shadcn/ui primitives (button, card, input, select, alert, badge, skeleton)
- NO new dependencies
- NO react-hook-form (native useState only)

Layer 2 architecture for future:
- CreateBetProvider can wrap multi-page wizard at route layout level
- Components self-contained, splittable into separate pages
- LocalStorage state persistence hook ready (not yet enabled)

Out of scope:
- Multi-page wizard (Layer 2 future)
- LocalStorage state persistence (Layer 2 hook present but disabled)
- Settlement UI (P26+)
- Wallet balance check (P26+)
- Pool-attached bets (peer-to-peer only in P25)
- React-hook-form
- E2E tests
EOF
)"

git push origin wip-p24-create-bet-page
git log --oneline -3
```

PAUSE.

### Step 10 — Open PR

```bash
gh pr create \
  --base main \
  --head wip-p24-create-bet-page \
  --title "P24+P25: Create-bet page with template picker" \
  --body "$(cat <<'EOF'
Frontend create-bet page integrating P20-P23 backend.

## What ships
Single-page /bets/new with 4 sections on single scroll:
1. **Template Picker** — 15 templates from P21, filter by category (Sport/Combat/Esports/Games)
2. **Bet Form** — pre-filled from template, user fills stake/side/expires
3. **Review Preview** — summary card, auto-shown when form complete
4. **Submit** — POST /api/bets via TanStack mutation, redirect to /bets/[id]

## Architecture (Layer β + α)
- **Layer β (implemented):** Single-page UI, all sections visible on scroll
- **Layer α (architecture-ready):** Context Provider opgezet zodat P26+ trivial naar multi-page wizard splitsen kan

## Stack
- @tanstack/react-query (state mgmt + caching)
- Sonner (toasts)
- shadcn/ui primitives (already installed)
- NO new dependencies
- NO react-hook-form (native useState)

## Validation
- Build succeeds
- TypeScript clean
- Mobile-responsive (Tailwind grid)
- Auth guard inherited from (app) layout

## Migration safety
- No schema changes
- No new dependencies
- Pure additive: new route + components
- No existing component modified

## Roadmap
- P20 ✅ BetTemplate schema
- P21 ✅ 15 templates seeded
- P22 ✅ Settlement methods
- P23 ✅ Resolution API endpoints
- **P24+P25 (this PR)** Create-bet page
- P26+ — Settlement UI, dispute UI, wallet balance integration

## Out of scope
- Multi-page wizard navigation
- LocalStorage state persistence
- React-hook-form
- Settlement UI
- E2E tests
EOF
)"
```

Report PR URL. DO NOT merge.

## Acceptance criteria

- [ ] `docs/PROMPT_P24_CREATE_BET_PAGE.md` committed
- [ ] /bets/new route exists and renders
- [ ] Template picker shows 15 templates with category filter
- [ ] Selecting template pre-fills form title
- [ ] Form has all 7 fields (title, outcomeA, outcomeB, side A/B, stake, expires)
- [ ] Review section auto-shows when form complete
- [ ] Submit button disabled until form complete
- [ ] Submit calls POST /api/bets with Idempotency-Key
- [ ] Success → redirect /bets/[id]
- [ ] Error → sonner toast with message
- [ ] `pnpm next build` succeeds
- [ ] TypeScript clean (0 errors)
- [ ] PR opened

## Stop conditions

- TanStack QueryClient NOT setup → install + add provider
- Pre-flight finds /bets/new already exists → SCOPE WIJZIGT, diagnose
- TypeScript errors in non-P24 files → STOP, regression
- pnpm build fails → STOP, fix per error
- Layout/auth guard mismatch → use src/app/bets/ ipv (app)/bets/

## Adversarial review

| Aanval | Verdediging |
|---|---|
| User submits without template | Submit button disabled until isComplete |
| User submits invalid stake (negative, NaN, 0) | isValidStake check (>=1), submit disabled |
| User submits 2x same idempotencyKey | Per-submit generate new UUID, no reuse |
| Network error mid-submit | TanStack auto-retry disabled (don't double-submit financial action) |
| User changes template mid-form | setTemplate clears nothing (preserves user input intentionally) — bug? See Design decision 6 line 35 |
| Mobile UX 1 column unusable | Tailwind sm:grid-cols-2 lg:grid-cols-3 responsive |
| Privy session expires during form | Submit 401 → toast + redirect /signin |
| Race: 2 useCreateBet calls | TanStack mutate single inflight protection |
| stakeUnits decimal precision loss | Math.round(stakeNum * 1_000_000) for micro-units |
| createBet API change breaks form | Pre-flight Step 1 verifies body shape |
| TemplateGrid loads while user typing | useQuery staleTime 5min, no remount mid-typing |

## Adversarial — bugs ik anticipeer

```
Bug 1: setTemplate change wipes form
  Design decision 6 line ~38: handleSetTemplate sets title but NOT outcomes
  Wenselijk gedrag? Hangt af van UX: user wisselt template → moet form leeg of behoud?
  Voor MVP: behoud user input behalve title. User kan handmatig title aanpassen.

Bug 2: stake input decimal handling
  String "25.00" → Number(25) → BigInt(25 * 1000000) = 25000000 micro-USDC = OK
  String "25.50" → Number(25.5) → Math.round(25500000) = 25500000 = OK
  String "25.555" → Number(25.555) → Math.round(25555000.0001) = 25555000 = OK (precision OK voor 3 decimalen)
  Edge: "25.5555" → Math.round(25555500.0001) = 25555500 → OK
  Voor MVP: precision past binnen 6 decimalen, BigInt overhead onnodig voor display.

Bug 3: Side button label uses outcome before set
  Side button toont "A: {outcomeA || 'Outcome A'}" — fallback OK
  Maar als user kiest side eerst, dan outcome invult, label update?
  Reactive, dus ja — Tailwind re-render correct.

Bug 4: Category filter reset on data refresh
  useState lokaal in TemplateGrid component
  Refresh via React Query → component re-renders maar state behoud
  OK, no bug.

Bug 5: Submit during isPending re-triggers
  Button disabled={!canSubmit} where canSubmit = ... && !isPending
  Race window? Single onClick handler, idiomatic React, OK.
```

## Notes for executor

1. **DO NOT** run `pnpm test` — productie DB
2. **DO NOT** run `pnpm dev` interactively — timeout in shell
3. **USE** `pnpm next build` for verification
4. **PRE-FLIGHT Step 1** is verplicht — TanStack setup must exist
5. Pre-existing Prisma deprecation warning — negeer
6. Next.js 15 syntax in Server Components — page.tsx is Server Component, components met "use client" zijn Client
7. Idempotency-Key MUST be UUIDv4 (parseIdempotencyKey server side validates)
8. shadcn/ui Select component already imported via primitives

## Tempo schatting

```
Step 0 spec commit:        5 min
Step 1 pre-flight:         10 min
Step 2 api/ files:         15 min
Step 3 hooks:              15 min
Step 4 context:            10 min
Step 5 template components: 20 min
Step 6 bet form components: 30 min
Step 7 page composition:   10 min
Step 8 build verify:       10 min
Step 9 commit + push:      5 min
Step 10 PR open:           5 min
─────────────────────────
TOTAL:                     2h 15min Claude Code execution

PR + Vercel CI: 5 min
Merge: 1 min
P24+P25 LIVE: ~2.5 hours from spec start
```

## Next steps after P24+P25 merge

- Manual smoke test on production /bets/new
- Verify template list loads
- Verify submit creates real bet (check /feed)
- P26 spec: Settlement UI (propose-result + confirm-result frontend)
- Estimate: 3-4 hours next session

Niet starten zonder explicit go signal voor P26.
