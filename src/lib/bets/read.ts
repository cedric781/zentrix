import "server-only";
import { Prisma, type Bet, type BetStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeCursor, decodeCursor } from "@/lib/http/pagination";

export interface ListBetsInput {
  userId: string;
  status?: BetStatus;
  cursor?: string;
  take?: number;
}

export interface ListBetsAdminInput {
  status?: BetStatus;
  offset?: number;
  take?: number;
  searchQ?: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OffsetPage<T> {
  items: T[];
  total: number;
  offset: number;
  take: number;
  hasMore: boolean;
}

const TAKE_USER_DEFAULT = 20;
const TAKE_USER_MAX = 50;
const TAKE_ADMIN_DEFAULT = 25;
const TAKE_ADMIN_MAX = 100;

export async function listBets(input: ListBetsInput): Promise<CursorPage<Bet>> {
  const take = Math.min(input.take ?? TAKE_USER_DEFAULT, TAKE_USER_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  const where: Prisma.BetWhereInput = {
    OR: [
      { createdById: input.userId },
      { opponentUserId: input.userId },
    ],
    ...(input.status && { status: input.status }),
  };

  const fetched = await prisma.bet.findMany({
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

export async function getBet(input: {
  id: string;
  userId?: string;
}): Promise<Bet | null> {
  const where: Prisma.BetWhereInput = {
    id: input.id,
    ...(input.userId && {
      OR: [
        { createdById: input.userId },
        { opponentUserId: input.userId },
      ],
    }),
  };
  return prisma.bet.findFirst({ where });
}

export async function listBetsAdmin(
  input: ListBetsAdminInput,
): Promise<OffsetPage<Bet>> {
  const offset = input.offset ?? 0;
  const take = Math.min(input.take ?? TAKE_ADMIN_DEFAULT, TAKE_ADMIN_MAX);

  const where: Prisma.BetWhereInput = {
    ...(input.status && { status: input.status }),
  };

  const [items, total] = await Promise.all([
    prisma.bet.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take,
    }),
    prisma.bet.count({ where }),
  ]);

  return {
    items,
    total,
    offset,
    take,
    hasMore: offset + items.length < total,
  };
}
