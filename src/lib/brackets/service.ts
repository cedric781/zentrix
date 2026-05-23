import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type PoolParticipant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockPool } from "@/lib/pools/service";
import {
  findReplayedResponse,
  recordMatchIdempotency,
} from "@/lib/matches/service";
import { PoolError } from "@/lib/pools/errors";
import { BracketError } from "./errors";
import {
  generateBrackets,
  type BracketFormat,
  type PlannedMatch,
} from "./generator";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 100;
const SEED_MIN = 1;
const SEED_MAX = 64;
const PARTICIPANTS_MAX = 64;

function assertUuidV4(key: string, fieldName: string): void {
  if (!UUID_V4.test(key)) {
    throw new BracketError(
      "BRACKET_INVALID_INPUT",
      `${fieldName} must be a UUID v4`,
      400,
    );
  }
}

function assertPoolEditable(pool: {
  status: string;
  bracketLockedAt: Date | null;
  createdById: string;
}, callerId: string): void {
  if (pool.createdById !== callerId) {
    throw new PoolError(
      "POOL_NOT_OWNED_BY_CALLER",
      "only the pool creator can manage participants",
      403,
    );
  }
  if (pool.status !== "DRAFT") {
    throw new PoolError(
      "POOL_INVALID_STATUS",
      `participant changes require pool status=DRAFT (got ${pool.status})`,
      409,
    );
  }
  if (pool.bracketLockedAt !== null) {
    throw new PoolError(
      "POOL_INVALID_STATUS",
      "bracket is already locked; participants are frozen",
      409,
    );
  }
}

// ── addParticipant ───────────────────────────────────────────────────

export interface AddParticipantInput {
  poolId: string;
  callerId: string;
  displayName: string;
  /** 1-indexed; auto-assigned to (count + 1) when omitted. */
  seed?: number;
  idempotencyKey: string;
}

export interface AddParticipantResult {
  participant: PoolParticipant;
}

export async function addParticipant(
  input: AddParticipantInput,
): Promise<AddParticipantResult> {
  const { poolId, callerId, displayName, seed, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const trimmedName = displayName.trim();
  if (
    trimmedName.length < DISPLAY_NAME_MIN ||
    trimmedName.length > DISPLAY_NAME_MAX
  ) {
    throw new BracketError(
      "BRACKET_INVALID_INPUT",
      `displayName length must be ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX}, got ${trimmedName.length}`,
      400,
    );
  }
  if (seed !== undefined) {
    if (!Number.isInteger(seed) || seed < SEED_MIN || seed > SEED_MAX) {
      throw new BracketError(
        "BRACKET_INVALID_INPUT",
        `seed must be integer in [${SEED_MIN}, ${SEED_MAX}], got ${seed}`,
        400,
      );
    }
  }

  const namespacedKey = `bracket-participant-add:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedResponse<{ participantId: string }>(
      tx,
      namespacedKey,
    );
    if (replayed) {
      const participant = await tx.poolParticipant.findUniqueOrThrow({
        where: { id: replayed.participantId },
      });
      return { participant };
    }

    await lockPool(tx, poolId);
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    assertPoolEditable(pool, callerId);

    const currentCount = await tx.poolParticipant.count({ where: { poolId } });
    if (currentCount >= PARTICIPANTS_MAX) {
      throw new BracketError(
        "BRACKET_INVALID_INPUT",
        `pool already has ${PARTICIPANTS_MAX} participants (max)`,
        409,
      );
    }

    let resolvedSeed: number;
    if (seed === undefined) {
      resolvedSeed = currentCount + 1;
    } else {
      const conflict = await tx.poolParticipant.findFirst({
        where: { poolId, seed },
        select: { id: true },
      });
      if (conflict !== null) {
        throw new BracketError(
          "BRACKET_INVALID_INPUT",
          `seed ${seed} is already taken in this pool`,
          409,
        );
      }
      resolvedSeed = seed;
    }

    const participant = await tx.poolParticipant.create({
      data: {
        poolId,
        displayName: trimmedName,
        seed: resolvedSeed,
      },
    });

    await recordMatchIdempotency(
      tx,
      namespacedKey,
      "bracket-participant-add",
      callerId,
      {
        participantId: participant.id,
        seed: resolvedSeed,
      } as Prisma.InputJsonValue,
    );

    return { participant };
  });
}

// ── removeParticipant ────────────────────────────────────────────────

export interface RemoveParticipantInput {
  participantId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface RemoveParticipantResult {
  removedId: string;
  freedSeed: number;
}

export async function removeParticipant(
  input: RemoveParticipantInput,
): Promise<RemoveParticipantResult> {
  const { participantId, callerId, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const namespacedKey = `bracket-participant-remove:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedResponse<{
      removedId: string;
      freedSeed: number;
    }>(tx, namespacedKey);
    if (replayed) {
      return { removedId: replayed.removedId, freedSeed: replayed.freedSeed };
    }

    const participant = await tx.poolParticipant.findUnique({
      where: { id: participantId },
    });
    if (!participant) {
      throw new BracketError(
        "BRACKET_PARTICIPANT_NOT_FOUND",
        `participant ${participantId} not found`,
        404,
      );
    }

    await lockPool(tx, participant.poolId);
    const pool = await tx.pool.findUniqueOrThrow({
      where: { id: participant.poolId },
    });
    assertPoolEditable(pool, callerId);

    const deletedSeed = participant.seed;
    await tx.poolParticipant.delete({ where: { id: participantId } });

    // Re-seed: keep dense 1..N by decrementing every seed > deletedSeed.
    // Postgres evaluates new values before applying the unique check, so the
    // statement is safe even though seeds clash transiently.
    await tx.poolParticipant.updateMany({
      where: { poolId: participant.poolId, seed: { gt: deletedSeed } },
      data: { seed: { decrement: 1 } },
    });

    await recordMatchIdempotency(
      tx,
      namespacedKey,
      "bracket-participant-remove",
      callerId,
      {
        removedId: participantId,
        freedSeed: deletedSeed,
      } as Prisma.InputJsonValue,
    );

    return { removedId: participantId, freedSeed: deletedSeed };
  });
}

// ── lockBracket ──────────────────────────────────────────────────────

export interface LockBracketInput {
  poolId: string;
  callerId: string;
  format: BracketFormat;
  idempotencyKey: string;
}

export interface LockBracketResult {
  matchCount: number;
  bracketLockedAt: Date;
}

export async function lockBracket(
  input: LockBracketInput,
): Promise<LockBracketResult> {
  const { poolId, callerId, format, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  if (format !== "SINGLE_ELIM" && format !== "DOUBLE_ELIM") {
    throw new BracketError(
      "BRACKET_INVALID_FORMAT",
      `format must be SINGLE_ELIM or DOUBLE_ELIM, got ${format}`,
      400,
    );
  }

  const namespacedKey = `bracket-lock:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedResponse<{
      matchCount: number;
      bracketLockedAtIso: string;
    }>(tx, namespacedKey);
    if (replayed) {
      return {
        matchCount: replayed.matchCount,
        bracketLockedAt: new Date(replayed.bracketLockedAtIso),
      };
    }

    await lockPool(tx, poolId);
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });

    if (pool.createdById !== callerId) {
      throw new PoolError(
        "POOL_NOT_OWNED_BY_CALLER",
        "only the pool creator can lock the bracket",
        403,
      );
    }
    if (pool.status !== "DRAFT") {
      throw new PoolError(
        "POOL_INVALID_STATUS",
        `bracket can only be locked while pool status=DRAFT (got ${pool.status})`,
        409,
      );
    }
    if (pool.bracketLockedAt !== null) {
      throw new BracketError(
        "BRACKET_ALREADY_LOCKED",
        `bracket already locked at ${pool.bracketLockedAt.toISOString()}`,
        409,
      );
    }

    const existingMatchCount = await tx.match.count({ where: { poolId } });
    if (existingMatchCount > 0) {
      throw new BracketError(
        "BRACKET_MATCHES_NOT_EMPTY",
        `pool has ${existingMatchCount} pre-existing matches; lockBracket requires an empty pool`,
        409,
      );
    }

    const participants = await tx.poolParticipant.findMany({
      where: { poolId },
      orderBy: [{ seed: "asc" }],
    });

    // generateBrackets enforces format-specific count + seed-density rules
    // and throws BracketError on violation. We pass through unchanged.
    const { matches: planned } = generateBrackets({
      format,
      participants: participants.map((p) => ({
        id: p.id,
        seed: p.seed,
        displayName: p.displayName,
      })),
    });

    // Phase 1: allocate UUIDs and insert all matches with FK pointers null.
    // FKs are wired in Phase 2 because Postgres checks them at INSERT time
    // (no DEFERRABLE on our constraints), so forward refs aren't allowed.
    const slotToUuid = new Map<string, string>();
    for (const m of planned) slotToUuid.set(m.slotKey, randomUUID());

    await tx.match.createMany({
      data: planned.map((m) => ({
        id: slotToUuid.get(m.slotKey)!,
        poolId,
        title: m.title,
        status: "SCHEDULED" as const,
        bracket: m.bracket,
        bracketSlot: m.bracketSlot,
        round: m.round,
        participantAId: m.participantAId,
        participantBId: m.participantBId,
      })),
    });

    // Phase 2: wire FKs for matches that have nextOnWin/Loss slot pointers.
    const updates = planned.filter(
      (m: PlannedMatch) =>
        m.nextOnWinSlotKey !== null || m.nextOnLossSlotKey !== null,
    );
    for (const m of updates) {
      await tx.match.update({
        where: { id: slotToUuid.get(m.slotKey)! },
        data: {
          nextMatchIdOnWin: m.nextOnWinSlotKey
            ? slotToUuid.get(m.nextOnWinSlotKey)!
            : null,
          nextMatchIdOnLoss: m.nextOnLossSlotKey
            ? slotToUuid.get(m.nextOnLossSlotKey)!
            : null,
        },
      });
    }

    const bracketLockedAt = new Date();
    const updatedPool = await tx.pool.updateMany({
      where: { id: poolId, bracketLockedAt: null },
      data: {
        tournamentFormat: format,
        bracketLockedAt,
      },
    });
    if (updatedPool.count !== 1) {
      throw new BracketError(
        "BRACKET_ALREADY_LOCKED",
        `pool ${poolId} concurrently locked`,
        409,
      );
    }

    await recordMatchIdempotency(
      tx,
      namespacedKey,
      "bracket-lock",
      callerId,
      {
        matchCount: planned.length,
        bracketLockedAtIso: bracketLockedAt.toISOString(),
      } as Prisma.InputJsonValue,
    );

    return { matchCount: planned.length, bracketLockedAt };
  });
}
