import "server-only";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { applyBps, FEES } from "@/lib/fees";
import {
  recordTransaction,
  getUserAccount,
  getTreasuryAccount,
  IdempotentReplayError,
} from "@/lib/ledger";
import { getOrCreateBetEscrowAccount } from "@/lib/bets/escrow";
import { LedgerFinalizerError } from "./errors";
import type { BetStatus } from "@prisma/client";
import type { LedgerOutcome } from "./prepare";

// ─── Constants ──────────────────────────────────────────────────────────────

const STALE_LOCK_MS = 5 * 60 * 1000;
const MAX_RETRIES = 10;

// ─── Types ──────────────────────────────────────────────────────────────────

interface FinalizationResult {
  success: boolean;
  betId: string;
  outcome: LedgerOutcome | null;
  ledgerTxId: string | null;
  error?: string;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Finalize ledger entries for a bet that has been marked with ledgerStatus=PENDING.
 *
 * Idempotent at every layer:
 *   L1: Claim guard (updateMany — only one caller wins)
 *   L2: ledgerFinalizedAt check (already done → early return)
 *   L3: recordTransaction idempotency key (ledger-finalize:{betId})
 *   L4: Snapshot re-verify inside $transaction (defends against mid-finalize drift)
 *
 * Call AFTER the transaction that set prepareLedgerFields() has committed.
 */
export async function finalizeLedgerForBet(
  betId: string,
  reason: string = "inline",
): Promise<FinalizationResult> {
  // ── Step 1: Claim + snapshot ──────────────────────────────────────────
  const claim = await claimBetForFinalization(betId, reason);
  if (!claim) {
    return { success: false, betId, outcome: null, ledgerTxId: null };
  }

  // ── Step 2: Load bet ──────────────────────────────────────────────────
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    select: {
      id: true,
      status: true,
      stakeUnits: true,
      createdById: true,
      opponentUserId: true,
      winnerId: true,
      ledgerStatus: true,
      ledgerTargetWinnerId: true,
      ledgerFinalizedAt: true,
      ledgerRetryCount: true,
    },
  });

  if (!bet) {
    await markLedgerFailed(betId, "LEDGER_INVARIANT_VIOLATION", "Bet not found after claim", true);
    return { success: false, betId, outcome: null, ledgerTxId: null, error: "Bet not found" };
  }

  // ── Step 3: Already finalized (convergent recovery) ───────────────────
  if (bet.ledgerFinalizedAt) {
    await markLedgerFinalized(betId, null);
    return { success: true, betId, outcome: claim.outcome, ledgerTxId: null };
  }

  // ── Step 4: Pre-validation ────────────────────────────────────────────
  const validationError = validatePreFinalize(bet, claim.outcome);
  if (validationError) {
    await markLedgerFailed(betId, "LEDGER_INVARIANT_VIOLATION", validationError, true);
    return { success: false, betId, outcome: claim.outcome, ledgerTxId: null, error: validationError };
  }

  // ── Step 5: Execute ledger operation ──────────────────────────────────
  try {
    const ledgerTxId = await executeLedgerFinalization(bet, claim);
    await markLedgerFinalized(betId, ledgerTxId);

    logger.info({ betId, outcome: claim.outcome, ledgerTxId, reason }, "ledger-finalize: success");
    return { success: true, betId, outcome: claim.outcome, ledgerTxId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTerminal = isTerminalError(err);

    await markLedgerFailed(betId, "LEDGER_SETTLEMENT_FAILED", message, isTerminal);

    logger.error(
      { betId, outcome: claim.outcome, reason, error: message, isTerminal, retryCount: bet.ledgerRetryCount },
      "ledger-finalize: failed",
    );
    return { success: false, betId, outcome: claim.outcome, ledgerTxId: null, error: message };
  }
}

// ─── Claim Logic ────────────────────────────────────────────────────────────

async function claimBetForFinalization(
  betId: string,
  workerId: string,
): Promise<{ outcome: LedgerOutcome; targetWinnerId: string | null } | null> {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS);

  const claimed = await prisma.bet.updateMany({
    where: {
      id: betId,
      OR: [
        { ledgerStatus: "PENDING" },
        {
          ledgerStatus: "FAILED",
          OR: [
            { ledgerNextRetryAt: null },
            { ledgerNextRetryAt: { lte: new Date() } },
          ],
        },
        {
          ledgerStatus: "PROCESSING",
          ledgerProcessingAt: { lt: staleCutoff },
        },
      ],
    },
    data: {
      ledgerStatus: "PROCESSING",
      ledgerProcessingAt: new Date(),
      ledgerProcessingBy: workerId,
      ledgerLastError: null,
    },
  });

  if (claimed.count === 0) return null;

  const snapshot = await prisma.bet.findUnique({
    where: { id: betId },
    select: { ledgerOutcome: true, ledgerTargetWinnerId: true },
  });
  if (!snapshot || !snapshot.ledgerOutcome) return null;
  if (snapshot.ledgerOutcome !== "SETTLE" && snapshot.ledgerOutcome !== "VOID") return null;

  return {
    outcome: snapshot.ledgerOutcome as LedgerOutcome,
    targetWinnerId: snapshot.ledgerTargetWinnerId,
  };
}

// ─── Mark Helpers ───────────────────────────────────────────────────────────

async function markLedgerFinalized(betId: string, ledgerTxId: string | null): Promise<void> {
  await prisma.bet.update({
    where: { id: betId },
    data: {
      ledgerStatus: "FINALIZED",
      ledgerFinalizedAt: new Date(),
      ledgerLastError: null,
      ledgerErrorCode: null,
      ledgerProcessingAt: null,
      ledgerProcessingBy: null,
      ledgerNextRetryAt: null,
    },
  });
}

async function markLedgerFailed(
  betId: string,
  errorCode: string,
  errorMessage: string,
  isTerminal: boolean,
): Promise<void> {
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    select: { ledgerRetryCount: true },
  });
  const retryCount = (bet?.ledgerRetryCount ?? 0) + 1;
  const exhausted = retryCount > MAX_RETRIES;

  await prisma.bet.update({
    where: { id: betId },
    data: {
      ledgerStatus: isTerminal || exhausted ? "FAILED_TERMINAL" : "FAILED",
      ledgerLastError: errorMessage.slice(0, 500),
      ledgerErrorCode: errorCode,
      ledgerRetryCount: retryCount,
      ledgerNextRetryAt: isTerminal || exhausted ? null : computeNextRetry(retryCount),
      ledgerProcessingAt: null,
      ledgerProcessingBy: null,
    },
  });
}

// ─── Ledger Execution ───────────────────────────────────────────────────────

async function executeLedgerFinalization(
  bet: {
    id: string;
    status: BetStatus;
    stakeUnits: bigint;
    createdById: string;
    opponentUserId: string | null;
  },
  snapshot: { outcome: LedgerOutcome; targetWinnerId: string | null },
): Promise<string> {
  const idempotencyKey = `ledger-finalize:${bet.id}`;

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.bet.findUnique({
      where: { id: bet.id },
      select: { ledgerOutcome: true, ledgerTargetWinnerId: true },
    });
    if (!current || current.ledgerOutcome !== snapshot.outcome) {
      throw new LedgerFinalizerError(
        "LEDGER_OUTCOME_MISMATCH",
        `ledgerOutcome drifted: snapshot=${snapshot.outcome} current=${current?.ledgerOutcome}`,
      );
    }
    if (snapshot.outcome === "SETTLE" && current.ledgerTargetWinnerId !== snapshot.targetWinnerId) {
      throw new LedgerFinalizerError(
        "LEDGER_OUTCOME_MISMATCH",
        `ledgerTargetWinnerId drifted during finalize`,
      );
    }

    const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);
    let ledgerTx;

    if (snapshot.outcome === "SETTLE") {
      const winnerId = snapshot.targetWinnerId!;
      const potUnits = bet.stakeUnits * 2n;
      const feeUnits = applyBps(potUnits, FEES.PLATFORM_BPS);
      const winnerPayout = potUnits - feeUnits;

      const winnerAcct = await getUserAccount(tx, winnerId);
      const treasuryAcct = await getTreasuryAccount(tx);

      ledgerTx = await recordTransaction({
        tx,
        idempotencyKey,
        description: `Ledger finalize settle (bet=${bet.id})`,
        initiatorUserId: winnerId,
        refType: "bet",
        refId: bet.id,
        lines: [
          {
            debitAccountId: escrowAcct.id,
            creditAccountId: winnerAcct.id,
            amountUnits: winnerPayout,
            entryType: "SETTLEMENT_PAYOUT",
            note: `ledger-finalize-payout:${bet.id}`,
          },
          {
            debitAccountId: escrowAcct.id,
            creditAccountId: treasuryAcct.id,
            amountUnits: feeUnits,
            entryType: "FEE_COLLECTION",
            note: `ledger-finalize-fee:${bet.id}`,
          },
        ],
      });
    } else {
      const creatorAcct = await getUserAccount(tx, bet.createdById);

      const lines = [
        {
          debitAccountId: escrowAcct.id,
          creditAccountId: creatorAcct.id,
          amountUnits: bet.stakeUnits,
          entryType: "ESCROW_RELEASE" as const,
          note: `ledger-finalize-void:${bet.id}:creator`,
        },
      ];

      if (bet.opponentUserId) {
        const opponentAcct = await getUserAccount(tx, bet.opponentUserId);
        lines.push({
          debitAccountId: escrowAcct.id,
          creditAccountId: opponentAcct.id,
          amountUnits: bet.stakeUnits,
          entryType: "ESCROW_RELEASE" as const,
          note: `ledger-finalize-void:${bet.id}:opponent`,
        });
      }

      ledgerTx = await recordTransaction({
        tx,
        idempotencyKey,
        description: `Ledger finalize void (bet=${bet.id})`,
        initiatorUserId: bet.createdById,
        refType: "bet",
        refId: bet.id,
        lines,
      });
    }

    await tx.betStateTransition.create({
      data: {
        betId: bet.id,
        fromStatus: bet.status,
        toStatus: bet.status,
        actorType: "SYSTEM_LEDGER_FINALIZER",
        actorId: null,
        metadata: {
          outcome: snapshot.outcome,
          ledgerTxId: ledgerTx.transaction.id,
        },
      },
    });

    return ledgerTx;
  }, { timeout: 30_000, maxWait: 10_000 });

  return result.transaction.id;
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validatePreFinalize(
  bet: {
    stakeUnits: bigint;
    opponentUserId: string | null;
    winnerId: string | null;
    ledgerTargetWinnerId: string | null;
    createdById: string;
  },
  outcome: LedgerOutcome,
): string | null {
  if (bet.stakeUnits <= 0n) {
    return `Invalid stakeUnits: ${bet.stakeUnits}`;
  }

  if (outcome === "SETTLE") {
    if (!bet.ledgerTargetWinnerId) {
      return "SETTLE outcome requires ledgerTargetWinnerId";
    }
    if (bet.ledgerTargetWinnerId !== bet.createdById && bet.ledgerTargetWinnerId !== bet.opponentUserId) {
      return `ledgerTargetWinnerId ${bet.ledgerTargetWinnerId} is not a participant`;
    }
    if (bet.winnerId && bet.winnerId !== bet.ledgerTargetWinnerId) {
      return `winnerId ${bet.winnerId} disagrees with ledgerTargetWinnerId ${bet.ledgerTargetWinnerId}`;
    }
  }

  return null;
}

// ─── Error Classification ───────────────────────────────────────────────────

function isTerminalError(err: unknown): boolean {
  if (err instanceof LedgerFinalizerError) return true;
  if (err instanceof IdempotentReplayError) return false;

  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("not a participant")) return true;
  if (msg.includes("requires ledgertargetwinnerid")) return true;
  if (msg.includes("invalid stakeunits")) return true;

  // Transient — retry
  return false;
}

// ─── Backoff ────────────────────────────────────────────────────────────────

function computeNextRetry(retryCount: number): Date {
  const seconds = Math.min(3600, Math.max(30, 2 ** retryCount * 15));
  return new Date(Date.now() + seconds * 1000);
}
