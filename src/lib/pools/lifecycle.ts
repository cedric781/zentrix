import type { Pool } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PoolError } from "./errors";

export interface CreatePoolInput {
  creatorId: string;
  title: string;
  description?: string;
  sideALabel: string;
  sideBLabel: string;
  bettingClosesAt: Date;
  creatorFeeBps: number;
}

const TITLE_MIN = 1;
const TITLE_MAX = 200;
const SIDE_LABEL_MIN = 1;
const SIDE_LABEL_MAX = 50;
const ONE_HOUR_MS = 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Create a new pool in DRAFT status.
 *
 * Validation order (fail-fast, top-down): title length → side label
 * lengths → side label distinctness (case-insensitive) → deadline
 * window → creator-fee range. Each violation throws a typed `PoolError`
 * with a specific `PoolErrorCode`; no generic Error / string throws.
 *
 * Status is set explicitly to `DRAFT` (redundant with the schema default,
 * kept for documentation at the call site). Publication is a separate
 * transition handled by `publishPool`.
 */
export async function createPool(input: CreatePoolInput): Promise<Pool> {
  const title = input.title.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    throw new PoolError(
      "POOL_TITLE_INVALID",
      "Title must be 1-200 characters",
      400,
      { actual: title.length },
    );
  }

  const sideA = input.sideALabel.trim();
  const sideB = input.sideBLabel.trim();
  if (
    sideA.length < SIDE_LABEL_MIN ||
    sideA.length > SIDE_LABEL_MAX ||
    sideB.length < SIDE_LABEL_MIN ||
    sideB.length > SIDE_LABEL_MAX
  ) {
    throw new PoolError(
      "POOL_SIDES_INVALID",
      "Side labels must be 1-50 chars each",
      400,
    );
  }
  if (sideA.toLowerCase() === sideB.toLowerCase()) {
    throw new PoolError("POOL_SIDES_INVALID", "Side labels must differ", 400);
  }

  const msAhead = input.bettingClosesAt.getTime() - Date.now();
  if (msAhead < ONE_HOUR_MS || msAhead > NINETY_DAYS_MS) {
    throw new PoolError(
      "POOL_DEADLINE_INVALID",
      "Deadline must be 1h-90d ahead",
      400,
      { msAhead },
    );
  }

  const min = parseInt(process.env.POOL_CREATOR_FEE_BPS_MIN ?? "100", 10);
  const max = parseInt(process.env.POOL_CREATOR_FEE_BPS_MAX ?? "500", 10);
  if (input.creatorFeeBps < min || input.creatorFeeBps > max) {
    throw new PoolError(
      "POOL_CREATOR_FEE_OUT_OF_RANGE",
      "Creator fee out of range",
      400,
      { actual: input.creatorFeeBps, min, max },
    );
  }

  return prisma.pool.create({
    data: {
      createdByUserId: input.creatorId,
      title,
      description: input.description?.trim() || null,
      sideALabel: sideA,
      sideBLabel: sideB,
      bettingClosesAt: input.bettingClosesAt,
      creatorFeeBps: input.creatorFeeBps,
      status: "DRAFT",
    },
  });
}
