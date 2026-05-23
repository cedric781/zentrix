import "server-only";
import { Prisma, type PoolParticipant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockPool } from "@/lib/pools/service";
import {
  findReplayedResponse,
  recordMatchIdempotency,
} from "@/lib/matches/service";
import { PoolError } from "@/lib/pools/errors";
import { BracketError } from "./errors";

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
