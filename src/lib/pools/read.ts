import "server-only";
import { Prisma, type Pool, type PoolStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeCursor, decodeCursor } from "@/lib/http/pagination";

export interface ListPoolsInput {
  scope: "mine" | "public";
  userId?: string;
  status?: PoolStatus;
  cursor?: string;
  take?: number;
}

const TAKE_USER_DEFAULT = 20;
const TAKE_USER_MAX = 50;

export const PUBLIC_STATUSES: PoolStatus[] = ["OPEN", "CLOSED", "SETTLED"];

const POOL_WITH_MATCHES = Prisma.validator<Prisma.PoolDefaultArgs>()({
  include: { matches: true },
});
export type PoolWithMatches = Prisma.PoolGetPayload<typeof POOL_WITH_MATCHES>;

export async function listPools(
  input: ListPoolsInput,
): Promise<{ items: Pool[]; nextCursor: string | null }> {
  const take = Math.min(input.take ?? TAKE_USER_DEFAULT, TAKE_USER_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  const where: Prisma.PoolWhereInput =
    input.scope === "mine"
      ? {
          createdById: input.userId,
          ...(input.status && { status: input.status }),
        }
      : {
          status: input.status ? input.status : { in: PUBLIC_STATUSES },
        };

  const fetched = await prisma.pool.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor && { cursor: { id: cursor.id }, skip: 1 }),
    take: take + 1,
  });

  const hasMore = fetched.length > take;
  const items = hasMore ? fetched.slice(0, take) : fetched;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() })
      : null;

  return { items, nextCursor };
}

export async function getPool(input: {
  id: string;
  userId?: string;
}): Promise<PoolWithMatches | null> {
  const where: Prisma.PoolWhereInput = {
    id: input.id,
    ...(input.userId && { createdById: input.userId }),
  };
  return prisma.pool.findFirst({
    where,
    include: { matches: true },
  });
}
