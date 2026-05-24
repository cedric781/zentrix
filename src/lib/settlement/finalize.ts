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
 *
 * Call AFTER the transaction that set prepareLedgerFields() has committed.
 */
export async function finalizeLedgerForBet(
  betId: string,
  reason: string = "inline",
): Promise<FinalizationResult> {
  // ── Step 1: Claim ─────────────────────────────────────────────────────
  const claimed = await claimBetForFinalization(betId, reason);
  if (!claimed) {
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
      ledgerOutcome: true,
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
    return { success: true, betId, outcome: bet.ledgerOutcome as LedgerOutcome, ledgerTxId: null };
  }

  const outcome = bet.ledgerOutcome as LedgerOutcome | null;
  if (!outcome || (outcome !== "SETTLE" && outcome !== "VOID")) {
    await markLedgerFailed(betId, "LEDGER_OUTCOME_MISMATCH", `Invalid ledgerOutcome: ${outcome}`, true);
    return { success: false, betId, outcome, ledgerTxId: null, error: `Invalid outcome: ${outcome}` };
  }

  // ── Step 4: Pre-validation ────────────────────────────────────────────
  const validationError = validatePreFinalize(bet, outcome);
  if (validationError) {
    await markLedgerFailed(betId, "LEDGER_INVARIANT_VIOLATION", validationError, true);
    return { success: false, betId, outcome, ledgerTxId: null, error: validationError };
  }

  // ── Step 5: Execute ledger operation ──────────────────────────────────
  try {
    const ledgerTxId = await executeLedgerFinalization(bet, outcome);
    await markLedgerFinalized(betId, ledgerTxId);

    logger.info({ betId, outcome, ledgerTxId, reason }, "ledger-finalize: success");
    return { success: true, betId, outcome, ledgerTxId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTerminal = isTerminalError(err);

    await markLedgerFailed(betId, "LEDGER_SETTLEMENT_FAILED", message, isTerminal);

    logger.error(
      { betId, outcome, reason, error: message, isTerminal, retryCount: bet.ledgerRetryCount },
      "ledger-finalize: failed",
    );
    return { success: false, betId, outcome, ledgerTxId: null, error: message };
  }
}

// ─── Claim Logic ────────────────────────────────────────────────────────────

async function claimBetForFinalization(betId: string, workerId: string): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS);

  const claimed = await prisma.bet.updateMany({
    where: {
      id: betId,
      OR: [
        { ledgerStatus: "PENDING" },
        { ledgerStatus: "FAILED" },
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

  return claimed.count > 0;
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
    stakeUnits: bigint;
    createdById: string;
    opponentUserId: string | null;
    ledgerTargetWinnerId: string | null;
  },
  outcome: LedgerOutcome,
): Promise<string> {
  const idempotencyKey = `ledger-finalize:${bet.id}`;

  const result = await prisma.$transaction(async (tx) => {
    const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);

    if (outcome === "SETTLE") {
      const winnerId = bet.ledgerTargetWinnerId!;
      const potUnits = bet.stakeUnits * 2n;
      const feeUnits = applyBps(potUnits, FEES.PLATFORM_BPS);
      const winnerPayout = potUnits - feeUnits;

      const winnerAcct = await getUserAccount(tx, winnerId);
      const treasuryAcct = await getTreasuryAccount(tx);

      return recordTransaction({
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
      // VOID: refund both participants
      const creatorAcct = await getUserAccount(tx, bet.createdById);
      const opponentAcct = await getUserAccount(tx, bet.opponentUserId!);

      return recordTransaction({
        tx,
        idempotencyKey,
        description: `Ledger finalize void (bet=${bet.id})`,
        initiatorUserId: bet.createdById,
        refType: "bet",
        refId: bet.id,
        lines: [
          {
            debitAccountId: escrowAcct.id,
            creditAccountId: creatorAcct.id,
            amountUnits: bet.stakeUnits,
            entryType: "ESCROW_RELEASE",
            note: `ledger-finalize-void:${bet.id}:creator`,
          },
          {
            debitAccountId: escrowAcct.id,
            creditAccountId: opponentAcct.id,
            amountUnits: bet.stakeUnits,
            entryType: "ESCROW_RELEASE",
            note: `ledger-finalize-void:${bet.id}:opponent`,
          },
        ],
      });
    }
  }, { timeout: 30_000, maxWait: 10_000 });

  return result.transaction.id;
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validatePreFinalize(
  bet: {
    stakeUnits: bigint;
    opponentUserId: string | null;
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
  }

  if (outcome === "VOID") {
    if (!bet.opponentUserId) {
      return "VOID outcome requires opponentUserId (both sides must be refunded)";
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
  if (msg.includes("requires opponentuserid")) return true;
  if (msg.includes("invalid stakeunits")) return true;

  // Transient — retry
  return false;
}

// ─── Backoff ────────────────────────────────────────────────────────────────

function computeNextRetry(retryCount: number): Date {
  const seconds = Math.min(3600, Math.max(30, 2 ** retryCount * 15));
  return new Date(Date.now() + seconds * 1000);
}
