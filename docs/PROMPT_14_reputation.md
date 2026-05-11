# PROMPT_14: User Reputation System

**Status**: locked design (2026-05-11). Geen wijzigingen zonder spec update + ADR.

## Scope

P14 implementeert het reputation systeem voor Zentrix users. Doel: track user behavior op het platform via een score-based model met audit trail, om vertrouwen te bouwen tussen P2P bet participants en om misbruik (frivole disputes, no-shows) te detecteren.

**In scope:**
- ReputationEvent audit log table (Prisma migration)
- UserReputation default score migration (100 → 500)
- trackReputationEvent service (sync, transactional)
- getUserReputation + getReputationTier read services
- recomputeTier helper (called when score crosses threshold)
- Service hooks in: confirmResult, openDispute, resolveDispute, forceCancelBet
- Idempotency keys per event (prevent double-charge)
- Unit tests covering all event types + tier transitions

**Out of scope (defer):**
- Tier enforcement in createBet/acceptBet/openDispute (P14b of P16)
- BET_EXPIRED event triggering (depends on P15 cron)
- ADMIN_PENALTY/BONUS events (depends on P17 admin UI)
- Score decay over time
- Reputation appeals process

## Design beslissingen (locked)

### 1. Score model
- Range: 0 (worst) tot 1000 (best). Geclampt aan beide ends.
- Starting score voor nieuwe users: 500 (neutraal).
- Score is `Int`, deltas zijn altijd integers.
- Schema migration: UserReputation.score default 100 → 500.

### 2. Event types + deltas (locked)

| Event Type            | Delta | Trigger                                              |
|-----------------------|-------|------------------------------------------------------|
| BET_SETTLED_CLEAN     | +2    | confirmResult mutual confirm zonder dispute          |
| DISPUTE_OPENED        | -5    | openDispute service call (friction tegen abuse)      |
| DISPUTE_WON           | +15   | resolveDispute outcome favor user (opener=winner)    |
| DISPUTE_LOST          | -25   | resolveDispute outcome against user (opener=loser)   |
| DISPUTE_VOID          | 0     | resolveDispute outcome VOID (neutral logged)         |
| FORCE_CANCELLED       | 0     | forceCancelBet impact (neutraal, niet user's fault)  |
| BET_EXPIRED           | -2    | (DEFER P15) bet timeout zonder confirmation          |
| ADMIN_PENALTY         | var   | (DEFER P17) admin handmatige strafmaat               |
| ADMIN_BONUS           | var   | (DEFER P17) admin handmatige bonus                   |

**Asymmetrie:** DISPUTE_LOST kost -25 maar DISPUTE_WON levert +15. Disputes als wapen moeten kosten hebben. Win = normaal, lost = beschuldiger had fout.

### 3. Tier thresholds (locked)

| Tier        | Score range  | Behavior (P14b enforcement scope)              |
|-------------|--------------|------------------------------------------------|
| NORMAL      | score ≥ 400  | Geen restricties                               |
| RESTRICTED  | 200..399     | (P14b) Max stake 50 USDC, dispute deposit 20%  |
| FLAGGED     | < 200        | (P14b) Block createBet/acceptBet/openDispute   |

P14 alleen tracking + read API. Enforcement gehoist naar P14b/P16.

### 4. Atomicity
- ReputationEvent INSERT + UserReputation counter UPDATE + tier recompute moeten binnen dezelfde Prisma.$transaction lopen als de triggering service call.
- Geen outbox pattern, geen async queue.

### 5. Idempotency
- ReputationEvent.idempotencyKey unique constraint.
- Format: `${userId}:${eventType}:${refType}:${refId}` (bv. "u-42:BET_SETTLED_CLEAN:bet:abc-123").
- userId in key prefix: cruciaal voor dual-participant events (FORCE_CANCELLED, BET_SETTLED_CLEAN) — zonder userId collision tussen creator en opponent.
- Bij duplicate insert: silently ignore (no error, no double charge).

### 6. forceCancelBet impact
- Admin force-cancel = neutraal. Geen DISPUTE_LOST automatisch.
- Wel ReputationEvent met FORCE_CANCELLED + delta 0 (audit trail).
- Admin kan later via P17 separate ADMIN_PENALTY toevoegen.

## Schema (Prisma)

### UserReputation (existing, default migration)

```prisma
model UserReputation {
  // existing fields onveranderd behalve:
  score Int @default(500) // CHANGED from 100
}
```

### ReputationEvent (new)

```prisma
model ReputationEvent {
  id              String              @id @default(uuid())
  userId          String              @map("user_id")
  eventType       ReputationEventType
  scoreDelta      Int                 @map("score_delta")
  scoreAfter      Int                 @map("score_after")
  tierBefore      ReputationTier      @map("tier_before")
  tierAfter       ReputationTier      @map("tier_after")
  refType         String?             @map("ref_type")
  refId           String?             @map("ref_id")
  metadata        Json?
  idempotencyKey  String              @unique @map("idempotency_key")
  createdAt       DateTime            @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@index([userId, createdAt], map: "idx_reputation_events_user")
  @@index([eventType], map: "idx_reputation_events_type")
  @@index([refType, refId], map: "idx_reputation_events_ref")
  @@map("reputation_events")
}

enum ReputationEventType {
  BET_SETTLED_CLEAN
  DISPUTE_OPENED
  DISPUTE_WON
  DISPUTE_LOST
  DISPUTE_VOID
  FORCE_CANCELLED
  BET_EXPIRED
  ADMIN_PENALTY
  ADMIN_BONUS
}
```

## Service surface

### trackReputationEvent (sync, transactional)

```typescript
export interface TrackReputationEventInput {
  tx: TxClient;
  userId: string;
  eventType: ReputationEventType;
  refType?: string;
  refId?: string;
  metadata?: Record<string, unknown>;
  customDelta?: number;
}

export interface TrackReputationEventResult {
  event: ReputationEvent;
  reputation: UserReputation;
  tierChanged: boolean;
}

export async function trackReputationEvent(
  input: TrackReputationEventInput
): Promise<TrackReputationEventResult>;
```

### getUserReputation (read)

```typescript
export async function getUserReputation(
  userId: string
): Promise<UserReputation>;
```

### getReputationTier (pure helper)

```typescript
export function getReputationTier(score: number): ReputationTier;
// 0..199 → FLAGGED, 200..399 → RESTRICTED, 400..1000 → NORMAL
```

## Constants

```typescript
export const REPUTATION_DELTAS: Record<ReputationEventType, number> = {
  BET_SETTLED_CLEAN: 2,
  DISPUTE_OPENED: -5,
  DISPUTE_WON: 15,
  DISPUTE_LOST: -25,
  DISPUTE_VOID: 0,
  FORCE_CANCELLED: 0,
  BET_EXPIRED: -2,
  ADMIN_PENALTY: 0,
  ADMIN_BONUS: 0,
};

export const REPUTATION_SCORE_MIN = 0;
export const REPUTATION_SCORE_MAX = 1000;
export const REPUTATION_SCORE_INITIAL = 500;

export const TIER_THRESHOLDS = {
  RESTRICTED_MIN: 200,
  NORMAL_MIN: 400,
} as const;
```

## Error codes

```typescript
export type ReputationErrorCode =
  | "REPUTATION_USER_NOT_FOUND"
  | "REPUTATION_INVALID_EVENT_TYPE"
  | "REPUTATION_DUPLICATE_EVENT"
  | "REPUTATION_INVALID_DELTA";

export class ReputationError extends Error {
  constructor(
    public code: ReputationErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "ReputationError";
  }
}
```

## Hook integration

### In confirmResult (src/lib/bets/service.ts)
NA mutual confirm succes, alleen als geen DISPUTED transition in BetStateTransition history.
Beide users → BET_SETTLED_CLEAN event.

### In openDispute (src/lib/disputes/service.ts)
NA dispute INSERT succes. Alleen opener → DISPUTE_OPENED.

### In resolveDispute (src/lib/disputes/service.ts)
NA outcome verwerkt:
- VOID: opener → DISPUTE_VOID (delta 0, audit only)
- CREATOR_WINS/OPPONENT_WINS: opener → DISPUTE_WON of DISPUTE_LOST afhankelijk van of opener=winner

### In forceCancelBet (src/lib/disputes/service.ts)
NA bet → CANCELLED succes. Beide participants → FORCE_CANCELLED (delta 0, audit).

## Implementation fasen

### Fase A — errors + types + constants
- Files: errors.ts, types.ts, constants.ts in src/lib/reputation/
- Geen migrations, geen body
- Acceptance: typecheck groen

### Fase B.0 — schema migration
- Schema delta + prisma migrate dev
- Acceptance: prisma generate groen, migratie applied

### Fase B.1 — trackReputationEvent body
- Idempotency check, UserReputation upsert, score clamp [0,1000], counter updates, tier recompute, tierChanged return
- Custom delta validation alleen voor ADMIN_*

### Fase B.2 — read services
- getUserReputation (lazy create), getReputationTier (pure)

### Fase B.3 — hook integration
- Edits in bets/service.ts (confirmResult) + disputes/service.ts (3 services)

### Fase B.4 — tests
- src/__tests__/reputation/reputation-events.test.ts
- ~10-15 tests: per event type happy path, idempotency, clamp, lazy create, tier transitions

## Acceptance criteria

1. Alle 6 actief-gewirede event types werken met juiste delta (BET_SETTLED_CLEAN, DISPUTE_OPENED, DISPUTE_WON, DISPUTE_LOST, DISPUTE_VOID, FORCE_CANCELLED). 3 deferred types (BET_EXPIRED, ADMIN_PENALTY, ADMIN_BONUS) hebben REPUTATION_DELTAS entries voor type completeness maar zijn niet hooked in P14
2. Score clamps [0, 1000]
3. Tier transitions correct per thresholds
4. Idempotency: 2x zelfde event = 1 row
5. ReputationEvent rows hebben volledige metadata
6. Counters synchroon met events
7. Hooks: services schrijven events binnen hun tx
8. Tests ≥10, allemaal groen WSL2 vitest
9. Geen breaking changes voor disputes/bets tests
10. Vercel CI: typecheck + build groen

## Files touched

- prisma/schema.prisma
- prisma/migrations/[timestamp]_p14_reputation/
- src/lib/reputation/errors.ts (new)
- src/lib/reputation/types.ts (new)
- src/lib/reputation/constants.ts (new)
- src/lib/reputation/service.ts (new)
- src/lib/reputation/index.ts (new)
- src/lib/bets/service.ts (hook in confirmResult)
- src/lib/disputes/service.ts (hooks in 3 services)
- src/__tests__/reputation/reputation-events.test.ts (new)
