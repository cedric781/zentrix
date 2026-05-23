import "server-only";
import { type PoolParticipant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PUBLIC_STATUSES } from "@/lib/pools/read";

export interface ListParticipantsInput {
  poolId: string;
  /** Caller user id; required to access DRAFT/CANCELLED pools (owner only). */
  userId?: string;
}

/**
 * List participants for a pool, sorted by seed ASC.
 *
 * Access rules mirror getPool:
 *   - Pools in PUBLIC_STATUSES (OPEN/CLOSED/SETTLED) → anyone with auth
 *   - DRAFT or CANCELLED → only the pool creator
 *
 * Returns [] if the pool doesn't exist or the caller can't see it; no error.
 */
export async function listParticipants(
  input: ListParticipantsInput,
): Promise<PoolParticipant[]> {
  const pool = await prisma.pool.findUnique({
    where: { id: input.poolId },
    select: { createdById: true, status: true },
  });
  if (!pool) return [];

  const isPublicReadable = PUBLIC_STATUSES.includes(pool.status);
  if (!isPublicReadable && pool.createdById !== input.userId) {
    return [];
  }

  return prisma.poolParticipant.findMany({
    where: { poolId: input.poolId },
    orderBy: [{ seed: "asc" }],
  });
}
