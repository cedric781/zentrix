import "server-only";
import { recordTransaction, getUserAccount, type TxClient } from "@/lib/ledger";
import { BetError } from "@/lib/bets/errors";
import { trackReputationEvent } from "@/lib/reputation/service";
import { logger } from "@/lib/logger";
import type { Bet } from "@prisma/client";

/**
 * Expire an OPEN bet past expiresAt timestamp.
 * Status: OPEN → EXPIRED
 * Refund: creator receives bet.stakeUnits (Wager pattern: per-participant stake)
 * Reputation: BET_EXPIRED event (-2 delta, creator only)
 * Idempotency: bet-expire:${betId}
 */
export async function expireOpenBet(
  betId: string,
  tx: TxClient,
): Promise<{ bet: Bet; ledgerTxId: string; reputationEventId: string }> {
  const bet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });

  if (bet.status !== "OPEN") {
    throw new BetError(
      "BET_INVALID_STATUS",
      `Cannot expire bet in status ${bet.status}`,
      400,
    );
  }
  if (!bet.expiresAt || bet.expiresAt > new Date()) {
    throw new BetError(
      "BET_NOT_EXPIRED",
      `Bet ${betId} expiresAt is in future`,
      400,
    );
  }

  const escrowAcct = await tx.financialAccount.findUniqueOrThrow({
    where: { scopeKey: `bet:${betId}` },
  });
  const creatorAcct = await getUserAccount(tx, bet.createdById);

  const ledgerResult = await recordTransaction({
    tx,
    idempotencyKey: `bet-expire:${betId}`,
    description: `Bet ${betId} expired, refunding creator`,
    initiatorUserId: bet.createdById,
    refType: "bet",
    refId: betId,
    lines: [
      {
        debitAccountId: escrowAcct.id,
        creditAccountId: creatorAcct.id,
        amountUnits: bet.stakeUnits,
        entryType: "ESCROW_RELEASE",
        note: `bet-expire-refund:${betId}`,
      },
    ],
  });

  const updated = await tx.bet.updateMany({
    where: { id: betId, version: bet.version, status: "OPEN" },
    data: { status: "EXPIRED", version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new BetError(
      "BET_VERSION_MISMATCH",
      `Bet ${betId} concurrently mutated during expire`,
      409,
    );
  }

  await tx.betStateTransition.create({
    data: {
      betId,
      fromStatus: "OPEN",
      toStatus: "EXPIRED",
      actorId: null,
      actorType: "SYSTEM_CRON",
      metadata: {
        reason: "expiresAt < now",
        ledgerTxId: ledgerResult.transaction.id,
      },
    },
  });

  const repResult = await trackReputationEvent({
    tx,
    userId: bet.createdById,
    eventType: "BET_EXPIRED",
    refType: "bet",
    refId: betId,
  });

  const expiredBet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });

  logger.info(
    {
      betId,
      creatorId: bet.createdById,
      refundUnits: bet.stakeUnits.toString(),
      ledgerTxId: ledgerResult.transaction.id,
    },
    "Bet expired",
  );

  return {
    bet: expiredBet,
    ledgerTxId: ledgerResult.transaction.id,
    reputationEventId: repResult.event.id,
  };
}

/**
 * Auto-void a RESULT_PROPOSED bet past confirmDeadline.
 * Status: RESULT_PROPOSED → VOID
 * Refund: each participant receives bet.stakeUnits (Wager no-fault pattern, no rounding)
 * Reputation: NONE (Wager no-fault policy)
 * Idempotency: bet-void:${betId} (single ledger tx with 2 lines)
 */
export async function autoVoidProposedBet(
  betId: string,
  tx: TxClient,
): Promise<{ bet: Bet; ledgerTxId: string }> {
  const bet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });

  if (bet.status !== "RESULT_PROPOSED") {
    throw new BetError(
      "BET_INVALID_STATUS",
      `Cannot void bet in status ${bet.status}`,
      400,
    );
  }
  if (!bet.confirmDeadline || bet.confirmDeadline > new Date()) {
    throw new BetError(
      "BET_NOT_VOIDED",
      `Bet ${betId} confirmDeadline is in future`,
      400,
    );
  }
  if (!bet.opponentUserId) {
    throw new BetError(
      "BET_NO_OPPONENT",
      `Bet ${betId} has no opponent (should not reach RESULT_PROPOSED)`,
      400,
    );
  }

  const escrowAcct = await tx.financialAccount.findUniqueOrThrow({
    where: { scopeKey: `bet:${betId}` },
  });
  const creatorAcct = await getUserAccount(tx, bet.createdById);
  const opponentAcct = await getUserAccount(tx, bet.opponentUserId);

  const ledgerResult = await recordTransaction({
    tx,
    idempotencyKey: `bet-void:${betId}`,
    description: `Bet ${betId} voided (confirmDeadline expired)`,
    initiatorUserId: bet.createdById,
    refType: "bet",
    refId: betId,
    lines: [
      {
        debitAccountId: escrowAcct.id,
        creditAccountId: creatorAcct.id,
        amountUnits: bet.stakeUnits,
        entryType: "ESCROW_RELEASE",
        note: `bet-void-refund:${betId}:creator`,
      },
      {
        debitAccountId: escrowAcct.id,
        creditAccountId: opponentAcct.id,
        amountUnits: bet.stakeUnits,
        entryType: "ESCROW_RELEASE",
        note: `bet-void-refund:${betId}:opponent`,
      },
    ],
  });

  const updated = await tx.bet.updateMany({
    where: { id: betId, version: bet.version, status: "RESULT_PROPOSED" },
    data: {
      status: "VOID",
      version: { increment: 1 },
      voidedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new BetError(
      "BET_VERSION_MISMATCH",
      `Bet ${betId} concurrently mutated during void`,
      409,
    );
  }

  await tx.betStateTransition.create({
    data: {
      betId,
      fromStatus: "RESULT_PROPOSED",
      toStatus: "VOID",
      actorId: null,
      actorType: "SYSTEM_CRON",
      metadata: {
        reason: "confirmDeadline < now",
        ledgerTxId: ledgerResult.transaction.id,
      },
    },
  });

  const voidBet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });

  logger.info(
    {
      betId,
      creatorId: bet.createdById,
      opponentId: bet.opponentUserId,
      refundUnitsPerUser: bet.stakeUnits.toString(),
      ledgerTxId: ledgerResult.transaction.id,
    },
    "Bet voided (confirmDeadline)",
  );

  return {
    bet: voidBet,
    ledgerTxId: ledgerResult.transaction.id,
  };
}

/**
 * Cleanup expired BetInvite tokens (expiresAt < now AND usedAt = null).
 */
export async function deleteExpiredBetInvites(tx: TxClient): Promise<number> {
  const result = await tx.betInvite.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
      usedAt: null,
    },
  });
  return result.count;
}

/**
 * Cleanup expired IdempotencyKey rows (expiresAt IS NOT NULL AND expiresAt < now).
 */
export async function deleteExpiredIdempotencyKeys(tx: TxClient): Promise<number> {
  const result = await tx.idempotencyKey.deleteMany({
    where: {
      expiresAt: { not: null, lt: new Date() },
    },
  });
  return result.count;
}
