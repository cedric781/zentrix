import "server-only";
// TODO(P30 prompt 6): integration smoke test on real Neon — covers TX rollback,
// version-conflict races, and the multi-step commit flows. Unit-level mocks
// for $transaction are fragile, so prompt 5 ships without them.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { fetchExternalResult, NoProviderAvailableError } from "./router";
import { CircuitOpenError } from "./circuit-breaker";
import { mapWinner } from "./winner-mapping";
import { trackReputationEvent } from "@/lib/reputation/service";
import { prepareLedgerFields } from "@/lib/settlement/prepare";
import { finalizeLedgerForBet } from "@/lib/settlement/finalize";
import type { SupportedSport } from "@/lib/api/types";

const BATCH_SIZE = 50;
const MAX_RETRIES = 5;
const BACKOFF_MIN_MS = 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

export function computeNextRetryAt(retryCount: number): Date {
  const delayMs = Math.min(
    BACKOFF_MIN_MS * Math.pow(2, retryCount),
    BACKOFF_MAX_MS,
  );
  return new Date(Date.now() + delayMs);
}

export type ResolveBatchStats = {
  total: number;
  resolved: number;
  voided: number;
  escalated: number;
  skipped: number;
  failed: number;
  failedIds: string[];
};

type RefWithBet = Prisma.BetExternalRefGetPayload<{
  include: {
    bet: {
      select: {
        id: true;
        status: true;
        outcomeA: true;
        outcomeB: true;
        creatorSide: true;
        createdById: true;
        opponentUserId: true;
        version: true;
      };
    };
  };
}>;

type Outcome = "resolved" | "voided" | "escalated" | "skipped" | "failed";

export async function resolveBetsBatch(): Promise<ResolveBatchStats> {
  const now = new Date();

  const refs = await prisma.betExternalRef.findMany({
    where: {
      eventEndsAt: { lte: now },
      processedAt: null,
      failedAt: null,
      resolvedAt: null,
      OR: [
        { nextRetryAt: null },
        { nextRetryAt: { lte: now } },
      ],
      bet: {
        status: { in: ["ACTIVE", "RESULT_PROPOSED", "AWAITING_CONFIRMATION"] },
      },
    },
    include: {
      bet: {
        select: {
          id: true,
          status: true,
          outcomeA: true,
          outcomeB: true,
          creatorSide: true,
          createdById: true,
          opponentUserId: true,
          version: true,
        },
      },
    },
    take: BATCH_SIZE,
    orderBy: { eventEndsAt: "asc" },
  });

  const stats: ResolveBatchStats = {
    total: refs.length,
    resolved: 0,
    voided: 0,
    escalated: 0,
    skipped: 0,
    failed: 0,
    failedIds: [],
  };

  for (const ref of refs) {
    try {
      const outcome = await processSingleRef(ref);
      stats[outcome]++;
    } catch (err) {
      logger.error(
        { refId: ref.id, betId: ref.betId, err: err instanceof Error ? err.message : String(err) },
        "resolve-bets: per-bet failure",
      );
      stats.failed++;
      stats.failedIds.push(ref.betId);
    }
  }

  logger.info({ ...stats }, "resolve-bets batch complete");
  return stats;
}

async function processSingleRef(ref: RefWithBet): Promise<Outcome> {
  let result;
  let provider: string;
  try {
    const fetched = await fetchExternalResult({
      eventId: ref.eventId,
      league: ref.league,
      sport: ref.sport as SupportedSport,
    });
    result = fetched.result;
    provider = fetched.provider;
  } catch (err) {
    return await handleFetchFailure(ref, err);
  }

  const mapping = mapWinner(result, ref.bet, ref.sport as SupportedSport);

  switch (mapping.kind) {
    case "not_ready":
      return "skipped";

    case "resolved":
      await commitWinnerResolution({
        ref,
        winnerSide: mapping.winnerSide,
        winnerUserId: mapping.winnerUserId,
        matchedTeam: mapping.matchedTeam,
        provider,
        rawResult: result,
      });
      return "resolved";

    case "draw":
      await commitVoid({ ref, reason: `draw: ${mapping.reason}`, rawResult: result });
      return "voided";

    case "failed":
      if (mapping.reason === "postponed") {
        return await scheduleRetry(ref, "event_postponed");
      }
      await commitVoid({ ref, reason: `event_${mapping.reason}`, rawResult: result });
      return "voided";

    case "ambiguous":
      await escalateToManual(ref, mapping.reason);
      return "escalated";

    default: {
      const _exhaustive: never = mapping;
      void _exhaustive;
      logger.error({ refId: ref.id }, "resolve-bets: unexpected mapping kind");
      return "failed";
    }
  }
}

async function handleFetchFailure(ref: RefWithBet, err: unknown): Promise<Outcome> {
  const isCircuitOpen = err instanceof CircuitOpenError;
  const isNoProvider = err instanceof NoProviderAvailableError;
  const message = err instanceof Error ? err.message : "unknown";

  if (isCircuitOpen) {
    logger.warn({ refId: ref.id, message }, "resolve-bets: circuit open, skipping");
    return "skipped";
  }

  if (ref.retryCount >= MAX_RETRIES) {
    await escalateToManual(ref, `max_retries_exceeded: ${message}`);
    return "escalated";
  }

  const _nextRetryAt = computeNextRetryAt(ref.retryCount);
  await prisma.betExternalRef.update({
    where: { id: ref.id },
    data: {
      retryCount: { increment: 1 },
      lastError: message.slice(0, 1000),
      nextRetryAt: _nextRetryAt,
      lastAttemptAt: new Date(),
    },
  });

  logger.info(
    { refId: ref.id, retryCount: ref.retryCount + 1, isNoProvider },
    "resolve-bets: scheduled retry",
  );
  return "skipped";
}

async function scheduleRetry(ref: RefWithBet, reason: string): Promise<Outcome> {
  if (ref.retryCount >= MAX_RETRIES) {
    await commitVoid({ ref, reason: `${reason}_max_retries`, rawResult: null });
    return "voided";
  }
  const _nextRetryAt = computeNextRetryAt(ref.retryCount);
  await prisma.betExternalRef.update({
    where: { id: ref.id },
    data: {
      retryCount: { increment: 1 },
      lastError: reason,
      nextRetryAt: _nextRetryAt,
      lastAttemptAt: new Date(),
    },
  });
  return "skipped";
}

async function commitWinnerResolution(params: {
  ref: RefWithBet;
  winnerSide: "A" | "B";
  winnerUserId: string;
  matchedTeam: string;
  provider: string;
  rawResult: unknown;
}): Promise<void> {
  const { ref, winnerSide, winnerUserId, matchedTeam, provider, rawResult } = params;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.bet.updateMany({
      where: { id: ref.bet.id, version: ref.bet.version },
      data: {
        status: "SETTLED",
        winnerId: winnerUserId,
        resultStatus: "CONFIRMED",
        settledAt: new Date(),
        version: { increment: 1 },
        ...prepareLedgerFields("SETTLE", winnerUserId),
      },
    });
    if (updated.count !== 1) {
      throw new Error(`bet_version_mismatch: ${ref.bet.id}`);
    }

    await tx.betStateTransition.create({
      data: {
        betId: ref.bet.id,
        fromStatus: ref.bet.status,
        toStatus: "SETTLED",
        actorType: "SYSTEM_EXTERNAL_RESOLVE",
        actorId: null,
        metadata: {
          winnerUserId,
          externalRefId: ref.id,
        },
      },
    });

    await tx.betExternalRef.update({
      where: { id: ref.id },
      data: {
        processedAt: new Date(),
        resolvedAt: new Date(),
        resolvedWinnerSide: winnerSide,
        resolvedPayload: rawResult as Prisma.InputJsonValue,
      },
    });

    logger.info(
      { betId: ref.bet.id, winnerSide, matchedTeam, provider },
      "resolve-bets: settled",
    );
  });

  try {
    await finalizeLedgerForBet(ref.bet.id, "external-resolve-settle");
    await prisma.$transaction(async (tx) => {
      await trackReputationEvent({
        tx,
        userId: winnerUserId,
        eventType: "BET_SETTLED_AUTO",
        refType: "BET",
        refId: ref.bet.id,
      });
    });
  } catch (err) {
    logger.error(
      { betId: ref.bet.id, err: err instanceof Error ? err.message : String(err) },
      "ledger finalize failed for settle — will retry via cron",
    );
  }
}

async function commitVoid(params: {
  ref: RefWithBet;
  reason: string;
  rawResult: unknown;
}): Promise<void> {
  const { ref, reason, rawResult } = params;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.bet.updateMany({
      where: { id: ref.bet.id, version: ref.bet.version },
      data: {
        status: "VOID",
        resultStatus: "OVERRIDDEN",
        voidedAt: new Date(),
        version: { increment: 1 },
        ...prepareLedgerFields("VOID"),
      },
    });
    if (updated.count !== 1) {
      throw new Error(`bet_version_mismatch: ${ref.bet.id}`);
    }

    await tx.betStateTransition.create({
      data: {
        betId: ref.bet.id,
        fromStatus: ref.bet.status,
        toStatus: "VOID",
        actorType: "SYSTEM_EXTERNAL_RESOLVE",
        actorId: null,
        metadata: {
          reason,
          externalRefId: ref.id,
        },
      },
    });

    await tx.betExternalRef.update({
      where: { id: ref.id },
      data: {
        processedAt: new Date(),
        resolvedAt: new Date(),
        resolvedWinnerSide: "VOID",
        resolvedPayload: rawResult as Prisma.InputJsonValue,
        lastError: reason,
      },
    });

    logger.info({ betId: ref.bet.id, reason }, "resolve-bets: voided");
  });

  try {
    await finalizeLedgerForBet(ref.bet.id, "external-resolve-void");
  } catch (err) {
    logger.error(
      { betId: ref.bet.id, err: err instanceof Error ? err.message : String(err) },
      "ledger finalize failed for void — will retry via cron",
    );
  }
}

async function escalateToManual(ref: RefWithBet, reason: string): Promise<void> {
  await prisma.betExternalRef.update({
    where: { id: ref.id },
    data: {
      processedAt: new Date(),
      failedAt: new Date(),
      lastError: reason.slice(0, 1000),
    },
  });

  logger.warn({ betId: ref.bet.id, reason }, "resolve-bets: escalated to manual");
}
