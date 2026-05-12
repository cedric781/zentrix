import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MATCH_WITH_REL = Prisma.validator<Prisma.MatchDefaultArgs>()({
  include: { pool: true, bets: true },
});
export type MatchWithRelations = Prisma.MatchGetPayload<typeof MATCH_WITH_REL>;

export async function getMatch(input: {
  id: string;
  userId?: string;
}): Promise<MatchWithRelations | null> {
  const where: Prisma.MatchWhereInput = {
    id: input.id,
    ...(input.userId && {
      OR: [
        { pool: { createdById: input.userId } },
        {
          bets: {
            some: {
              OR: [
                { createdById: input.userId },
                { opponentUserId: input.userId },
              ],
            },
          },
        },
      ],
    }),
  };
  return prisma.match.findFirst({
    where,
    include: { pool: true, bets: true },
  });
}
