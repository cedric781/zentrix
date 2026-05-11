import "server-only";
import { Prisma } from "@prisma/client";
import type {
  ReputationEvent,
  ReputationEventType,
  ReputationTier,
  UserReputation,
} from "@prisma/client";
import { type TxClient } from "@/lib/ledger";
import { ReputationError } from "./errors";
import {
  ADMIN_EVENT_TYPES,
  REPUTATION_DELTAS,
  REPUTATION_SCORE_INITIAL,
  REPUTATION_SCORE_MAX,
  REPUTATION_SCORE_MIN,
  TIER_THRESHOLDS,
} from "./constants";
import type {
  TrackReputationEventInput,
  TrackReputationEventResult,
} from "./types";

// ── public helpers ────────────────────────────────────────────────────

/**
 * Pure helper: bereken tier op basis van score.
 * 0..199 → FLAGGED, 200..399 → RESTRICTED, 400..1000 → NORMAL.
 */
export function getReputationTier(score: number): ReputationTier {
  if (score < TIER_THRESHOLDS.RESTRICTED_MIN) return "FLAGGED";
  if (score < TIER_THRESHOLDS.NORMAL_MIN) return "RESTRICTED";
  return "NORMAL";
}

// ── private helpers ───────────────────────────────────────────────────

function buildIdempotencyKey(
  eventType: ReputationEventType,
  refType: string | undefined,
  refId: string | undefined,
): string {
  return `${eventType}:${refType ?? "null"}:${refId ?? "null"}`;
}

function clampScore(score: number): number {
  return Math.max(REPUTATION_SCORE_MIN, Math.min(REPUTATION_SCORE_MAX, score));
}

async function getOrCreateUserReputation(
  tx: TxClient,
  userId: string,
): Promise<{ id: string }> {
  // findUnique → create → P2002 retry pattern (race-safe lazy create)
  const existing = await tx.userReputation.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) return existing;

  try {
    const created = await tx.userReputation.create({
      data: {
        userId,
        score: REPUTATION_SCORE_INITIAL,
        tier: "NORMAL",
      },
      select: { id: true },
    });
    return created;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // race: andere call heeft tegelijk gecreëerd. Re-fetch.
      const refetched = await tx.userReputation.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (refetched) return refetched;
    }
    throw err;
  }
}

async function lockUserReputation(
  tx: TxClient,
  userId: string,
): Promise<{
  id: string;
  score: number;
  tier: ReputationTier;
  disputesOpened: number;
  disputesWon: number;
  disputesLost: number;
}> {
  const rows = (await tx.$queryRaw`
    SELECT id, score, tier, disputes_opened AS "disputesOpened",
           disputes_won AS "disputesWon", disputes_lost AS "disputesLost"
    FROM user_reputations
    WHERE user_id = ${userId}
    FOR UPDATE
  `) as Array<{
    id: string;
    score: number;
    tier: ReputationTier;
    disputesOpened: number;
    disputesWon: number;
    disputesLost: number;
  }>;
  if (rows.length !== 1) {
    throw new ReputationError(
      "REPUTATION_USER_NOT_FOUND",
      `UserReputation row not found for user ${userId} after lazy create`,
      500,
    );
  }
  return rows[0];
}

// ── main service ──────────────────────────────────────────────────────

export async function trackReputationEvent(
  input: TrackReputationEventInput,
): Promise<TrackReputationEventResult> {
  const { tx, userId, eventType, refType, refId, metadata, customDelta } = input;

  // 1. Custom delta validation
  if (customDelta !== undefined) {
    if (!ADMIN_EVENT_TYPES.includes(eventType)) {
      throw new ReputationError(
        "REPUTATION_INVALID_DELTA",
        `customDelta only allowed for ADMIN_* events, got ${eventType}`,
        400,
      );
    }
    if (!Number.isInteger(customDelta)) {
      throw new ReputationError(
        "REPUTATION_INVALID_DELTA",
        `customDelta must be integer, got ${customDelta}`,
        400,
      );
    }
  }

  // 2. Build idempotency key
  const idempotencyKey = buildIdempotencyKey(eventType, refType, refId);

  // 3. Pre-check idempotency (silent return on duplicate)
  const existingEvent = await tx.reputationEvent.findUnique({
    where: { idempotencyKey },
  });
  if (existingEvent) {
    const reputation = await tx.userReputation.findUniqueOrThrow({
      where: { userId },
    });
    return {
      event: existingEvent,
      reputation,
      tierChanged: false,
    };
  }

  // 4. Lazy create UserReputation (race-safe)
  await getOrCreateUserReputation(tx, userId);

  // 5. Lock row for consistency
  const current = await lockUserReputation(tx, userId);

  // 6. Compute new score + tier
  const effectiveDelta =
    customDelta !== undefined ? customDelta : REPUTATION_DELTAS[eventType];
  const newScore = clampScore(current.score + effectiveDelta);
  const newTier = getReputationTier(newScore);
  const tierChanged = current.tier !== newTier;

  // 7. Counter increments per event type
  const counterUpdates: {
    disputesOpened?: { increment: 1 };
    disputesWon?: { increment: 1 };
    disputesLost?: { increment: 1 };
  } = {};
  if (eventType === "DISPUTE_OPENED") counterUpdates.disputesOpened = { increment: 1 };
  if (eventType === "DISPUTE_WON") counterUpdates.disputesWon = { increment: 1 };
  if (eventType === "DISPUTE_LOST") counterUpdates.disputesLost = { increment: 1 };

  // 8. UPDATE UserReputation
  const updatedReputation = await tx.userReputation.update({
    where: { userId },
    data: {
      score: newScore,
      tier: newTier,
      ...counterUpdates,
    },
  });

  // 9. INSERT ReputationEvent (P2002 here = race after pre-check = duplicate)
  let event: ReputationEvent;
  try {
    event = await tx.reputationEvent.create({
      data: {
        userId,
        eventType,
        scoreDelta: effectiveDelta,
        scoreAfter: newScore,
        tierBefore: current.tier,
        tierAfter: newTier,
        refType: refType ?? null,
        refId: refId ?? null,
        ...(metadata !== undefined
          ? { metadata: metadata as Prisma.InputJsonValue }
          : {}),
        idempotencyKey,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ReputationError(
        "REPUTATION_DUPLICATE_EVENT",
        `Duplicate reputation event detected after pre-check (race condition): ${idempotencyKey}`,
        409,
      );
    }
    throw err;
  }

  return {
    event,
    reputation: updatedReputation,
    tierChanged,
  };
}
