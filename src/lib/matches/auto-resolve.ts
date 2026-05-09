import "server-only";
import { prisma } from "@/lib/prisma";
import { settleBet } from "@/lib/bets/settlement";
import { lockMatch } from "./service";
import { MatchError } from "./errors";

export interface AutoResolveResult {
  resolvedCount: number;
  skippedCount: number;
}

export interface AutoResolveOptions {
  skipDisputeWindow?: boolean;
  actorId?: string | null;
}

const TX_TIMEOUT_MS = 30_000;

export async function autoResolveMatchBets(
  matchId: string,
  options: AutoResolveOptions = {},
): Promise<AutoResolveResult> {
  const { skipDisputeWindow = false, actorId = null } = options;

  return await prisma.$transaction(
    async (tx) => {
      await lockMatch(tx, matchId);
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
      });

      if (match.status === "SETTLED") {
        return { resolvedCount: 0, skippedCount: 0 };
      }
      if (match.status !== "RESULT_SUBMITTED") {
        throw new MatchError(
          "MATCH_INVALID_STATUS",
          `cannot auto-resolve from status=${match.status}`,
          409,
        );
      }
      if (!match.winnerSide) {
        throw new MatchError(
          "MATCH_INVALID_STATUS",
          "match has no winnerSide set",
          409,
        );
      }
      if (!skipDisputeWindow) {
        if (
          !match.disputeWindowEndsAt ||
          match.disputeWindowEndsAt > new Date()
        ) {
          throw new MatchError(
            "MATCH_INVALID_STATUS",
            `dispute window still open until ${match.disputeWindowEndsAt?.toISOString()}`,
            409,
          );
        }
      }

      const pool = await tx.pool.findUniqueOrThrow({
        where: { id: match.poolId },
      });
      const winnerSide = match.winnerSide;
      const settleActorId = actorId ?? pool.createdById;

      const activeBets = await tx.bet.findMany({
        where: { matchId, status: "ACTIVE" },
      });

      let resolvedCount = 0;
      const skippedCount = 0;

      for (const bet of activeBets) {
        if (!bet.opponentUserId) {
          throw new Error(
            `bet ${bet.id} is ACTIVE without opponentUserId — invariant violation`,
          );
        }
        const winnerId =
          bet.creatorSide === winnerSide
            ? bet.createdById
            : bet.opponentUserId;

        await settleBet(tx, {
          bet,
          winnerId,
          ledgerIdempotencyKey: `bet-settle:${bet.id}`,
          fromStatus: "ACTIVE",
          actorId: settleActorId,
        });
        resolvedCount++;
      }

      const updated = await tx.match.updateMany({
        where: { id: matchId, status: "RESULT_SUBMITTED" },
        data: { status: "SETTLED", settledAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new MatchError(
          "MATCH_VERSION_MISMATCH",
          `match ${matchId} concurrently mutated`,
          409,
        );
      }

      return { resolvedCount, skippedCount };
    },
    { timeout: TX_TIMEOUT_MS },
  );
}
