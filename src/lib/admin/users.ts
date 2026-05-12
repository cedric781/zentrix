import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface ListUsersAdminInput {
  offset?: number;
  take?: number;
  searchQ?: string;
}

const TAKE_ADMIN_DEFAULT = 25;
const TAKE_ADMIN_MAX = 100;

const USER_WITH_ACCOUNT = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: { financialAccount: true },
});
export type UserWithAccount = Prisma.UserGetPayload<typeof USER_WITH_ACCOUNT>;

export async function listUsersAdmin(input: ListUsersAdminInput): Promise<{
  items: UserWithAccount[];
  total: number;
  offset: number;
  take: number;
  hasMore: boolean;
}> {
  const offset = input.offset ?? 0;
  const take = Math.min(input.take ?? TAKE_ADMIN_DEFAULT, TAKE_ADMIN_MAX);

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take,
      include: { financialAccount: true },
    }),
    prisma.user.count(),
  ]);

  return {
    items,
    total,
    offset,
    take,
    hasMore: offset + items.length < total,
  };
}
