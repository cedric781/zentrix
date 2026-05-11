import "server-only";
import type { Bet, Dispute } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyBps, FEES } from "@/lib/fees";
import { recordTransaction, getUserAccount, type TxClient } from "@/lib/ledger";
import { BetError } from "@/lib/bets/errors";
import { lockBet } from "@/lib/bets/service";
import { lockMatch } from "@/lib/matches/service";
import { IDEMPOTENCY_TTL_MS } from "@/lib/pools/service";
import { DisputeError } from "./errors";
import { getOrCreateDisputeEscrowAccount } from "./escrow";

// ── helpers ──────────────────────────────────────────────────────────

export async function lockDispute(
  tx: TxClient,
  disputeId: string,
): Promise<{ id: string }> {
  const rows = (await tx.$queryRaw`
    SELECT id FROM disputes WHERE id = ${disputeId} FOR UPDATE
  `) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new DisputeError(
      "DISPUTE_NOT_FOUND",
      `Dispute ${disputeId} not found`,
      404,
    );
  }
  return { id: rows[0].id };
}

// ── service inputs/outputs ───────────────────────────────────────────

export interface OpenDisputeInput {
  betId: string;
  openerId: string;
  reason: string;
  idempotencyKey: string;
}

export interface OpenDisputeResult {
  dispute: Dispute;
  depositUnits: bigint;
  ledgerTxId: string;
}

export interface SubmitDisputeEvidenceInput {
  disputeId: string;
  uploaderId: string;
  items: Array<{
    type: "TEXT" | "URL" | "IMAGE" | "VIDEO";
    fileUrl?: string;
    contentHash: string;
    description?: string;
  }>;
  idempotencyKey: string;
}

export interface SubmitDisputeEvidenceResult {
  dispute: Dispute;
  evidenceAdded: number;
  evidenceTotal: number;
}

export interface ResolveDisputeInput {
  disputeId: string;
  adminId: string;
  outcome: "CREATOR_WINS" | "OPPONENT_WINS" | "VOID";
  adminNotes?: string;
  idempotencyKey: string;
}

export interface ResolveDisputeResult {
  dispute: Dispute;
  bet: Bet;
  ledgerTxIds: string[];
}

export interface ForceCancelBetInput {
  betId: string;
  adminId: string;
  reason: string;
  idempotencyKey: string;
}

export interface ForceCancelBetResult {
  bet: Bet;
  ledgerTxId: string | null;
}

// ── service stubs (to be implemented in fase B+) ─────────────────────

export async function openDispute(
  input: OpenDisputeInput,
): Promise<OpenDisputeResult> {
  const { betId, openerId, reason, idempotencyKey } = input;

  if (reason.length < 1 || reason.length > 2000) {
    throw new DisputeError(
      "DISPUTE_INVALID_INPUT",
      "reason must be between 1 and 2000 characters",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_key: { userId: openerId, key: idempotencyKey } },
      });
      const now = new Date();
      if (
        existingKey?.responseJson &&
        existingKey.expiresAt &&
        existingKey.expiresAt > now
      ) {
        const cached = existingKey.responseJson as {
          disputeId: string;
          depositUnits: string;
          ledgerTxId: string;
        };
        const cachedDispute = await tx.dispute.findUniqueOrThrow({
          where: { id: cached.disputeId },
        });
        return {
          dispute: cachedDispute,
          depositUnits: BigInt(cached.depositUnits),
          ledgerTxId: cached.ledgerTxId,
        };
      }
      await tx.idempotencyKey.upsert({
        where: { userId_key: { userId: openerId, key: idempotencyKey } },
        create: {
          key: idempotencyKey,
          userId: openerId,
          scope: "dispute",
          route: "dispute-open",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
        update: {
          scope: "dispute",
          route: "dispute-open",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });

      await lockBet(tx, betId);
      const bet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });
      if (bet.matchId) {
        await lockMatch(tx, bet.matchId);
      }

      if (
        bet.status !== "ACTIVE" &&
        bet.status !== "RESULT_PROPOSED" &&
        bet.status !== "AWAITING_CONFIRMATION" &&
        bet.status !== "DISPUTED"
      ) {
        throw new DisputeError(
          "DISPUTE_INVALID_STATUS",
          `Bet ${betId} status ${bet.status} not eligible for dispute`,
          409,
        );
      }
      if (bet.createdById !== openerId && bet.opponentUserId !== openerId) {
        throw new DisputeError(
          "DISPUTE_NOT_PARTICIPANT",
          `User ${openerId} is not a participant of bet ${betId}`,
          403,
        );
      }
      const existingOpenDispute = await tx.dispute.findFirst({
        where: {
          betId,
          status: { in: ["OPEN", "EVIDENCE_PHASE", "ADMIN_REVIEW"] },
        },
      });
      if (existingOpenDispute) {
        throw new DisputeError(
          "DISPUTE_ALREADY_OPEN",
          `Bet ${betId} already has an open dispute`,
          409,
        );
      }
      if (bet.matchId) {
        const match = await tx.match.findUniqueOrThrow({
          where: { id: bet.matchId },
        });
        if (match.status !== "RESULT_SUBMITTED") {
          throw new DisputeError(
            "DISPUTE_INVALID_STATUS",
            `Match ${bet.matchId} status ${match.status} not eligible for dispute`,
            409,
          );
        }
        if (match.disputeWindowEndsAt && match.disputeWindowEndsAt < now) {
          throw new DisputeError(
            "DISPUTE_OUTSIDE_WINDOW",
            `Dispute window for match ${bet.matchId} has closed`,
            409,
          );
        }
      }

      const calculatedDeposit = applyBps(
        bet.stakeUnits,
        FEES.DISPUTE_DEPOSIT_BPS,
      );
      const depositUnits =
        calculatedDeposit < FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS
          ? FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS
          : calculatedDeposit;

      const dispute = await tx.dispute.create({
        data: {
          betId,
          openedById: openerId,
          reason,
          status: "OPEN",
        },
      });

      const openerAccount = await getUserAccount(tx, openerId);
      if (openerAccount.balanceUnits < depositUnits) {
        throw new DisputeError(
          "DISPUTE_INSUFFICIENT_BALANCE",
          `Insufficient balance to lock dispute deposit of ${depositUnits} units (have ${openerAccount.balanceUnits})`,
          402,
        );
      }
      const escrowAccount = await getOrCreateDisputeEscrowAccount(
        tx,
        dispute.id,
      );

      const ledgerResult = await recordTransaction({
        tx,
        idempotencyKey: `dispute-deposit:${dispute.id}`,
        description: `Dispute deposit (dispute=${dispute.id}, bet=${betId})`,
        initiatorUserId: openerId,
        refType: "dispute",
        refId: dispute.id,
        lines: [
          {
            debitAccountId: openerAccount.id,
            creditAccountId: escrowAccount.id,
            amountUnits: depositUnits,
            entryType: "ESCROW_LOCK",
          },
        ],
      });
      const ledgerTxId = ledgerResult.transaction.id;

      await tx.dispute.update({
        where: { id: dispute.id },
        data: { depositLedgerTxId: ledgerTxId },
      });

      let betStatusChanged = false;
      if (bet.status !== "DISPUTED") {
        const updateRes = await tx.bet.updateMany({
          where: { id: betId, version: bet.version, status: bet.status },
          data: {
            status: "DISPUTED",
            resultStatus: "DISPUTED",
            version: bet.version + 1,
          },
        });
        if (updateRes.count !== 1) {
          throw new BetError(
            "BET_VERSION_MISMATCH",
            `Bet ${betId} concurrently mutated`,
            409,
          );
        }
        betStatusChanged = true;
      }

      if (bet.matchId) {
        await tx.match.updateMany({
          where: { id: bet.matchId, status: "RESULT_SUBMITTED" },
          data: { status: "DISPUTED" },
        });
      }

      if (betStatusChanged) {
        await tx.betStateTransition.create({
          data: {
            betId,
            fromStatus: bet.status,
            toStatus: "DISPUTED",
            actorId: openerId,
            actorType: "USER",
            metadata: {
              disputeId: dispute.id,
              depositLedgerTxId: ledgerTxId,
              depositUnits: depositUnits.toString(),
            },
          },
        });
      }

      await tx.idempotencyKey.update({
        where: { userId_key: { userId: openerId, key: idempotencyKey } },
        data: {
          responseJson: {
            disputeId: dispute.id,
            depositUnits: depositUnits.toString(),
            ledgerTxId,
          },
          statusCode: 201,
          completedAt: new Date(),
        },
      });

      const refreshed = await tx.dispute.findUniqueOrThrow({
        where: { id: dispute.id },
      });
      return {
        dispute: refreshed,
        depositUnits,
        ledgerTxId,
      };
    },
    { timeout: 15000, maxWait: 5000 },
  );
}

export async function submitDisputeEvidence(
  _input: SubmitDisputeEvidenceInput,
): Promise<SubmitDisputeEvidenceResult> {
  throw new Error("submitDisputeEvidence: not implemented");
}

export async function resolveDispute(
  _input: ResolveDisputeInput,
): Promise<ResolveDisputeResult> {
  throw new Error("resolveDispute: not implemented");
}

export async function forceCancelBet(
  _input: ForceCancelBetInput,
): Promise<ForceCancelBetResult> {
  throw new Error("forceCancelBet: not implemented");
}
