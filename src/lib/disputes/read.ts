import "server-only";
import { Prisma, type DisputeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeCursor, decodeCursor } from "@/lib/http/pagination";

export interface ListDisputesInput {
  userId: string;
  status?: DisputeStatus;
  cursor?: string;
  take?: number;
}

export interface ListDisputesAdminInput {
  status?: DisputeStatus;
  offset?: number;
  take?: number;
  searchQ?: string;
}

const TAKE_USER_DEFAULT = 20;
const TAKE_USER_MAX = 50;
const TAKE_ADMIN_DEFAULT = 25;
const TAKE_ADMIN_MAX = 100;

const DISPUTE_WITH_BET = Prisma.validator<Prisma.DisputeDefaultArgs>()({
  include: { bet: true },
});
export type DisputeWithBet = Prisma.DisputeGetPayload<typeof DISPUTE_WITH_BET>;

export async function listDisputes(
  input: ListDisputesInput,
): Promise<{ items: DisputeWithBet[]; nextCursor: string | null }> {
  const take = Math.min(input.take ?? TAKE_USER_DEFAULT, TAKE_USER_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  const where: Prisma.DisputeWhereInput = {
    OR: [
      { openedById: input.userId },
      { bet: { createdById: input.userId } },
      { bet: { opponentUserId: input.userId } },
    ],
    ...(input.status && { status: input.status }),
  };

  const fetched = await prisma.dispute.findMany({
    where,
    include: { bet: true },
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

export async function getDispute(input: {
  id: string;
  userId?: string;
}): Promise<DisputeWithBet | null> {
  const where: Prisma.DisputeWhereInput = {
    id: input.id,
    ...(input.userId && {
      OR: [
        { openedById: input.userId },
        { bet: { createdById: input.userId } },
        { bet: { opponentUserId: input.userId } },
      ],
    }),
  };
  return prisma.dispute.findFirst({ where, include: { bet: true } });
}

export async function listDisputesAdmin(
  input: ListDisputesAdminInput,
): Promise<{
  items: DisputeWithBet[];
  total: number;
  offset: number;
  take: number;
  hasMore: boolean;
}> {
  const offset = input.offset ?? 0;
  const take = Math.min(input.take ?? TAKE_ADMIN_DEFAULT, TAKE_ADMIN_MAX);
  const status = input.status ?? "OPEN";

  const where: Prisma.DisputeWhereInput = { status };

  const [items, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      include: { bet: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take,
    }),
    prisma.dispute.count({ where }),
  ]);

  return {
    items,
    total,
    offset,
    take,
    hasMore: offset + items.length < total,
  };
}
