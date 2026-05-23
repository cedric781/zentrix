import "server-only";
import { Prisma, type Pool, type TournamentFormat } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type TxClient } from "@/lib/ledger";
import { PoolError } from "./errors";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TITLE_MIN = 1;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const BETTING_DEADLINE_MIN_MS = 60 * 60 * 1000;
const BETTING_DEADLINE_MAX_MS = 90 * 24 * 60 * 60 * 1000;

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreatePoolInput {
  creatorId: string;
  title: string;
  description?: string;
  /** Defaults to SIMPLE. Set at create time to declare tournament intent;
   * actual bracket generation still requires lockBracket. */
  tournamentFormat?: TournamentFormat;
  bettingClosesAt: Date;
  idempotencyKey: string;
}

export interface CreatePoolResult {
  pool: Pool;
}

export interface PublishPoolInput {
  poolId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface PublishPoolResult {
  pool: Pool;
}

export interface ClosePoolInput {
  poolId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface ClosePoolResult {
  pool: Pool;
}

export interface CancelPoolInput {
  poolId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface CancelPoolResult {
  pool: Pool;
}

// ── helpers ──────────────────────────────────────────────────────────

export async function lockPool(
  tx: TxClient,
  poolId: string,
): Promise<{ id: string }> {
  const rows = (await tx.$queryRaw`
    SELECT id FROM pools WHERE id = ${poolId} FOR UPDATE
  `) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new PoolError("POOL_NOT_FOUND", `Pool ${poolId} not found`, 404);
  }
  return { id: rows[0].id };
}

function assertUuidV4(key: string, fieldName: string): void {
  if (!UUID_V4.test(key)) {
    throw new PoolError("POOL_INVALID_INPUT", `${fieldName} must be a UUID v4`, 400);
  }
}

async function findReplayedPool(
  tx: TxClient,
  namespacedKey: string,
): Promise<Pool | null> {
  const existing = await tx.idempotencyKey.findUnique({
    where: { key: namespacedKey },
  });
  if (!existing) return null;
  if (!existing.responseJson) {
    throw new Error(`IdempotencyKey ${namespacedKey} has no responseJson`);
  }
  const { poolId } = existing.responseJson as { poolId: string };
  return await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
}

async function recordIdempotency(
  tx: TxClient,
  namespacedKey: string,
  scope: string,
  userId: string,
  poolId: string,
): Promise<void> {
  await tx.idempotencyKey.create({
    data: {
      key: namespacedKey,
      scope,
      userId,
      responseJson: { poolId } as Prisma.InputJsonValue,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
  });
}

function cancelStateMessage(status: string): string {
  switch (status) {
    case "OPEN":
      return "pool is published; close via dispute/refund flow (P13/P15)";
    case "CLOSED":
      return "pool is closed; settlement runs per-match (P12)";
    case "SETTLED":
      return "pool already settled; no action needed";
    case "CANCELLED":
      return "pool already cancelled";
    default:
      return `pool in unexpected state ${status}`;
  }
}

// ── createPool ───────────────────────────────────────────────────────

export async function createPool(
  input: CreatePoolInput,
): Promise<CreatePoolResult> {
  const {
    creatorId,
    title,
    description,
    tournamentFormat,
    bettingClosesAt,
    idempotencyKey,
  } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const trimmedTitle = title.trim();
  if (trimmedTitle.length < TITLE_MIN || trimmedTitle.length > TITLE_MAX) {
    throw new PoolError(
      "POOL_INVALID_INPUT",
      `title length must be ${TITLE_MIN}-${TITLE_MAX}, got ${trimmedTitle.length}`,
      400,
    );
  }

  const trimmedDescription = description?.trim();
  if (trimmedDescription !== undefined && trimmedDescription.length > DESCRIPTION_MAX) {
    throw new PoolError(
      "POOL_INVALID_INPUT",
      `description length must be ≤${DESCRIPTION_MAX}, got ${trimmedDescription.length}`,
      400,
    );
  }

  if (!(bettingClosesAt instanceof Date) || Number.isNaN(bettingClosesAt.getTime())) {
    throw new PoolError("POOL_INVALID_INPUT", "bettingClosesAt must be a valid Date", 400);
  }
  const msAhead = bettingClosesAt.getTime() - Date.now();
  if (msAhead < BETTING_DEADLINE_MIN_MS || msAhead > BETTING_DEADLINE_MAX_MS) {
    throw new PoolError(
      "POOL_DEADLINE_INVALID",
      `bettingClosesAt must be 1h to 90d ahead, got ${msAhead}ms`,
      400,
    );
  }

  const namespacedKey = `pool-create:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedPool(tx, namespacedKey);
    if (replayed) return { pool: replayed };

    const pool = await tx.pool.create({
      data: {
        createdById: creatorId,
        title: trimmedTitle,
        description: trimmedDescription ?? null,
        status: "DRAFT",
        tournamentFormat: tournamentFormat ?? "SIMPLE",
        bettingClosesAt,
      },
    });

    await recordIdempotency(tx, namespacedKey, "pool-create", creatorId, pool.id);

    return { pool };
  });
}

// ── publishPool ──────────────────────────────────────────────────────

export async function publishPool(
  input: PublishPoolInput,
): Promise<PublishPoolResult> {
  const { poolId, callerId, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const namespacedKey = `pool-publish:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedPool(tx, namespacedKey);
    if (replayed) return { pool: replayed };

    await lockPool(tx, poolId);
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });

    if (pool.createdById !== callerId) {
      throw new PoolError(
        "POOL_NOT_OWNED_BY_CALLER",
        "only the pool creator can publish",
        403,
      );
    }
    if (pool.status !== "DRAFT") {
      throw new PoolError(
        "POOL_INVALID_STATUS",
        `cannot publish from status=${pool.status}`,
        409,
      );
    }
    if (pool.bettingClosesAt.getTime() <= Date.now()) {
      throw new PoolError(
        "POOL_DEADLINE_INVALID",
        "deadline already passed at create-time validation, re-validation failed at publish",
        400,
      );
    }
    if (
      pool.tournamentFormat !== "SIMPLE" &&
      pool.bracketLockedAt === null
    ) {
      throw new PoolError(
        "POOL_INVALID_STATUS",
        "lock bracket before publishing tournament pool",
        409,
      );
    }

    const updated = await tx.pool.updateMany({
      where: { id: poolId, status: "DRAFT" },
      data: { status: "OPEN" },
    });
    if (updated.count !== 1) {
      throw new PoolError(
        "POOL_VERSION_MISMATCH",
        `pool ${poolId} concurrently mutated`,
        409,
      );
    }

    await recordIdempotency(tx, namespacedKey, "pool-publish", callerId, poolId);

    const finalPool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    return { pool: finalPool };
  });
}

// ── closePool ────────────────────────────────────────────────────────

export async function closePool(
  input: ClosePoolInput,
): Promise<ClosePoolResult> {
  const { poolId, callerId, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const namespacedKey = `pool-close:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedPool(tx, namespacedKey);
    if (replayed) return { pool: replayed };

    await lockPool(tx, poolId);
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });

    if (pool.createdById !== callerId) {
      throw new PoolError(
        "POOL_NOT_OWNED_BY_CALLER",
        "only the pool creator can close",
        403,
      );
    }
    if (pool.status !== "OPEN") {
      throw new PoolError(
        "POOL_INVALID_STATUS",
        `cannot close from status=${pool.status}`,
        409,
      );
    }

    const updated = await tx.pool.updateMany({
      where: { id: poolId, status: "OPEN" },
      data: { status: "CLOSED" },
    });
    if (updated.count !== 1) {
      throw new PoolError(
        "POOL_VERSION_MISMATCH",
        `pool ${poolId} concurrently mutated`,
        409,
      );
    }

    await recordIdempotency(tx, namespacedKey, "pool-close", callerId, poolId);

    const finalPool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    return { pool: finalPool };
  });
}

// ── cancelPool ───────────────────────────────────────────────────────

export async function cancelPool(
  input: CancelPoolInput,
): Promise<CancelPoolResult> {
  const { poolId, callerId, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const namespacedKey = `pool-cancel:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedPool(tx, namespacedKey);
    if (replayed) return { pool: replayed };

    await lockPool(tx, poolId);
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });

    if (pool.createdById !== callerId) {
      throw new PoolError(
        "POOL_NOT_OWNED_BY_CALLER",
        "only the pool creator can cancel",
        403,
      );
    }
    if (pool.status !== "DRAFT") {
      throw new PoolError(
        "POOL_HAS_BETS_CANNOT_CANCEL",
        cancelStateMessage(pool.status),
        409,
      );
    }

    const betCount = await tx.bet.count({ where: { poolId } });
    if (betCount > 0) {
      throw new PoolError(
        "POOL_HAS_BETS_CANNOT_CANCEL",
        "pool has attached bets; cannot cancel — defensive guard, indicates corrupt state if reached on a DRAFT pool",
        409,
      );
    }

    const updated = await tx.pool.updateMany({
      where: { id: poolId, status: "DRAFT" },
      data: { status: "CANCELLED" },
    });
    if (updated.count !== 1) {
      throw new PoolError(
        "POOL_VERSION_MISMATCH",
        `pool ${poolId} concurrently mutated`,
        409,
      );
    }

    await recordIdempotency(tx, namespacedKey, "pool-cancel", callerId, poolId);

    const finalPool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    return { pool: finalPool };
  });
}
