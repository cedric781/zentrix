import "server-only";
import type { Bet, Dispute, DisputeOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyBps, FEES } from "@/lib/fees";
import { recordTransaction, getUserAccount, getTreasuryAccount, type TxClient } from "@/lib/ledger";
import { BetError } from "@/lib/bets/errors";
import { lockBet } from "@/lib/bets/service";
import { settleBet } from "@/lib/bets/settlement";
import { getOrCreateBetEscrowAccount } from "@/lib/bets/escrow";
import { lockMatch } from "@/lib/matches/service";
import { IDEMPOTENCY_TTL_MS } from "@/lib/pools/service";
import { DisputeError } from "./errors";
import { isAdmin } from "./admin";
import { getOrCreateDisputeEscrowAccount } from "./escrow";
import { trackReputationEvent } from "@/lib/reputation/service";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

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

async function disposeDeposit(
  tx: TxClient,
  dispute: Dispute,
  bet: Bet,
  opener: { id: string },
  outcome: DisputeOutcome,
  ledgerIdempotencyKey: string,
): Promise<{ ledgerTxId: string; destination: "OPENER" | "TREASURY" }> {
  const opener_won_dispute =
    (outcome === "CREATOR_WINS" && opener.id === bet.createdById) ||
    (outcome === "OPPONENT_WINS" && opener.id === bet.opponentUserId) ||
    outcome === "VOID";

  const escrow = await getOrCreateDisputeEscrowAccount(tx, dispute.id);
  const balance = escrow.balanceUnits;
  if (balance === 0n) {
    return {
      ledgerTxId: "",
      destination: opener_won_dispute ? "OPENER" : "TREASURY",
    };
  }

  const destAcct = opener_won_dispute
    ? await getUserAccount(tx, opener.id)
    : await getTreasuryAccount(tx);

  const result = await recordTransaction({
    tx,
    idempotencyKey: ledgerIdempotencyKey,
    description: `Dispute deposit dispositie (dispute=${dispute.id}, outcome=${outcome})`,
    initiatorUserId: undefined,
    refType: "dispute",
    refId: dispute.id,
    lines: [
      {
        debitAccountId: escrow.id,
        creditAccountId: destAcct.id,
        amountUnits: balance,
        entryType: opener_won_dispute ? "ESCROW_RELEASE" : "FEE_COLLECTION",
        note: opener_won_dispute
          ? `dispute-deposit-refund:${dispute.id}`
          : `dispute-deposit-forfeit:${dispute.id}`,
      },
    ],
  });

  return {
    ledgerTxId: result.transaction.id,
    destination: opener_won_dispute ? "OPENER" : "TREASURY",
  };
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

      // P14 hook: DISPUTE_OPENED voor opener
      await trackReputationEvent({
        tx,
        userId: openerId,
        eventType: "DISPUTE_OPENED",
        refType: "dispute",
        refId: dispute.id,
      });

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
  input: SubmitDisputeEvidenceInput,
): Promise<SubmitDisputeEvidenceResult> {
  const { disputeId, uploaderId, items, idempotencyKey } = input;

  if (items.length === 0) {
    throw new DisputeError(
      "DISPUTE_INVALID_INPUT",
      "items must contain at least 1 evidence entry",
      400,
    );
  }
  const allowedTypes = ["TEXT", "URL", "IMAGE", "VIDEO"] as const;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!allowedTypes.includes(item.type)) {
      throw new DisputeError(
        "DISPUTE_EVIDENCE_INVALID",
        `items[${i}].type must be one of TEXT|URL|IMAGE|VIDEO`,
        400,
      );
    }
    if (typeof item.contentHash !== "string" || !SHA256_HEX.test(item.contentHash)) {
      throw new DisputeError(
        "DISPUTE_EVIDENCE_INVALID",
        `items[${i}].contentHash must be 64-char sha256 hex`,
        400,
      );
    }
    if (item.type !== "TEXT") {
      if (typeof item.fileUrl !== "string" || item.fileUrl.length === 0) {
        throw new DisputeError(
          "DISPUTE_EVIDENCE_INVALID",
          `items[${i}].fileUrl required for type=${item.type}`,
          400,
        );
      }
    }
  }

  return prisma.$transaction(
    async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_key: { userId: uploaderId, key: idempotencyKey } },
      });
      const now = new Date();
      if (
        existingKey?.responseJson &&
        existingKey.expiresAt &&
        existingKey.expiresAt > now
      ) {
        const cached = existingKey.responseJson as {
          disputeId: string;
          evidenceAdded: number;
          evidenceTotal: number;
        };
        const cachedDispute = await tx.dispute.findUniqueOrThrow({
          where: { id: cached.disputeId },
        });
        return {
          dispute: cachedDispute,
          evidenceAdded: cached.evidenceAdded,
          evidenceTotal: cached.evidenceTotal,
        };
      }
      await tx.idempotencyKey.upsert({
        where: { userId_key: { userId: uploaderId, key: idempotencyKey } },
        create: {
          key: idempotencyKey,
          userId: uploaderId,
          scope: "dispute-evidence",
          route: "dispute-evidence",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
        update: {
          scope: "dispute-evidence",
          route: "dispute-evidence",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });

      await lockDispute(tx, disputeId);
      const dispute = await tx.dispute.findUniqueOrThrow({
        where: { id: disputeId },
      });
      await lockBet(tx, dispute.betId);
      const bet = await tx.bet.findUniqueOrThrow({
        where: { id: dispute.betId },
      });

      if (dispute.status !== "OPEN" && dispute.status !== "EVIDENCE_PHASE") {
        throw new DisputeError(
          "DISPUTE_INVALID_STATUS",
          `Dispute ${disputeId} status ${dispute.status} not eligible for evidence submission`,
          409,
        );
      }
      if (bet.createdById !== uploaderId && bet.opponentUserId !== uploaderId) {
        throw new DisputeError(
          "DISPUTE_NOT_PARTICIPANT",
          `User ${uploaderId} is not a participant of bet ${dispute.betId}`,
          403,
        );
      }

      const seen = new Set<string>();
      const dedupedItems = items.filter((item) => {
        if (seen.has(item.contentHash)) return false;
        seen.add(item.contentHash);
        return true;
      });

      const existingHashRows = await tx.betEvidence.findMany({
        where: {
          betId: dispute.betId,
          contentHash: { in: dedupedItems.map((it) => it.contentHash) },
        },
        select: { contentHash: true },
      });
      const existingHashSet = new Set(
        existingHashRows.map((e) => e.contentHash),
      );
      const newItems = dedupedItems.filter(
        (item) => !existingHashSet.has(item.contentHash),
      );

      const currentUploaderCount = await tx.betEvidence.count({
        where: { betId: dispute.betId, uploadedById: uploaderId },
      });
      if (currentUploaderCount + newItems.length > 10) {
        throw new DisputeError(
          "DISPUTE_EVIDENCE_LIMIT",
          `Evidence limit of 10 per uploader exceeded (have ${currentUploaderCount}, attempting +${newItems.length})`,
          400,
        );
      }

      if (newItems.length > 0) {
        await tx.betEvidence.createMany({
          data: newItems.map((item) => ({
            betId: dispute.betId,
            uploadedById: uploaderId,
            type: item.type,
            fileUrl: item.fileUrl ?? null,
            contentHash: item.contentHash,
            description: `[dispute:${disputeId}] ${item.description ?? ""}`,
          })),
        });
      }

      if (dispute.status === "OPEN") {
        const promo = await tx.dispute.updateMany({
          where: { id: disputeId, status: "OPEN" },
          data: { status: "EVIDENCE_PHASE" },
        });
        if (promo.count !== 1) {
          throw new DisputeError(
            "DISPUTE_VERSION_MISMATCH",
            `Dispute ${disputeId} concurrently mutated`,
            409,
          );
        }
      }

      const evidenceAdded = newItems.length;
      const evidenceTotal = await tx.betEvidence.count({
        where: { betId: dispute.betId },
      });

      await tx.idempotencyKey.update({
        where: { userId_key: { userId: uploaderId, key: idempotencyKey } },
        data: {
          responseJson: {
            disputeId,
            evidenceAdded,
            evidenceTotal,
          },
          statusCode: 200,
          completedAt: new Date(),
        },
      });

      const refreshed = await tx.dispute.findUniqueOrThrow({
        where: { id: disputeId },
      });
      return {
        dispute: refreshed,
        evidenceAdded,
        evidenceTotal,
      };
    },
    { timeout: 15000, maxWait: 5000 },
  );
}

export async function resolveDispute(
  input: ResolveDisputeInput,
): Promise<ResolveDisputeResult> {
  const { disputeId, adminId, outcome, adminNotes, idempotencyKey } = input;

  if (!isAdmin(adminId)) {
    throw new DisputeError(
      "DISPUTE_NOT_ADMIN",
      `User ${adminId} is not an admin`,
      403,
    );
  }

  if (adminNotes !== undefined && adminNotes.length > 5000) {
    throw new DisputeError(
      "DISPUTE_INVALID_INPUT",
      "adminNotes must be max 5000 characters",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_key: { userId: adminId, key: idempotencyKey } },
      });
      const now = new Date();
      if (
        existingKey?.responseJson &&
        existingKey.expiresAt &&
        existingKey.expiresAt > now
      ) {
        const cached = existingKey.responseJson as {
          disputeId: string;
          betId: string;
          ledgerTxIds: string[];
        };
        const cachedDispute = await tx.dispute.findUniqueOrThrow({
          where: { id: cached.disputeId },
        });
        const cachedBet = await tx.bet.findUniqueOrThrow({
          where: { id: cached.betId },
        });
        return {
          dispute: cachedDispute,
          bet: cachedBet,
          ledgerTxIds: cached.ledgerTxIds,
        };
      }
      await tx.idempotencyKey.upsert({
        where: { userId_key: { userId: adminId, key: idempotencyKey } },
        create: {
          key: idempotencyKey,
          userId: adminId,
          scope: "dispute-resolve",
          route: "dispute-resolve",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
        update: {
          scope: "dispute-resolve",
          route: "dispute-resolve",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });

      await lockDispute(tx, disputeId);
      const dispute = await tx.dispute.findUniqueOrThrow({
        where: { id: disputeId },
      });

      if (
        dispute.status !== "OPEN" &&
        dispute.status !== "EVIDENCE_PHASE" &&
        dispute.status !== "ADMIN_REVIEW"
      ) {
        throw new DisputeError(
          "DISPUTE_INVALID_STATUS",
          `Dispute ${disputeId} status ${dispute.status} not eligible for resolve`,
          409,
        );
      }

      await lockBet(tx, dispute.betId);
      const bet = await tx.bet.findUniqueOrThrow({
        where: { id: dispute.betId },
      });
      if (bet.matchId) {
        await lockMatch(tx, bet.matchId);
      }

      const opener = { id: dispute.openedById };
      const ledgerTxIds: string[] = [];

      if (outcome === "CREATOR_WINS" || outcome === "OPPONENT_WINS") {
        const winnerId =
          outcome === "CREATOR_WINS" ? bet.createdById : bet.opponentUserId;
        if (!winnerId) {
          throw new DisputeError(
            "DISPUTE_INVALID_STATUS",
            `Bet ${bet.id} has no ${outcome === "CREATOR_WINS" ? "creator" : "opponent"}`,
            409,
          );
        }
        await settleBet(tx, {
          bet,
          winnerId,
          ledgerIdempotencyKey: `dispute-resolve:${disputeId}`,
          fromStatus: "DISPUTED",
          actorId: adminId,
          feeOverrideBps: FEES.DISPUTE_RESOLUTION_BPS,
          actorType: "ADMIN_DISPUTE_RESOLVE",
        });
        const settleTx = await tx.ledgerTransaction.findUnique({
          where: { idempotencyKey: `dispute-resolve:${disputeId}` },
        });
        if (settleTx) {
          ledgerTxIds.push(settleTx.id);
        }
      } else if (outcome === "VOID") {
        if (!bet.opponentUserId) {
          throw new DisputeError(
            "DISPUTE_INVALID_STATUS",
            `Bet ${bet.id} has no opponent for VOID refund`,
            409,
          );
        }
        const creatorAcct = await getUserAccount(tx, bet.createdById);
        const opponentAcct = await getUserAccount(tx, bet.opponentUserId);
        const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);

        const voidLedger = await recordTransaction({
          tx,
          idempotencyKey: `dispute-resolve-void:${disputeId}`,
          description: `Dispute VOID refund (bet=${bet.id}, dispute=${disputeId})`,
          initiatorUserId: adminId,
          refType: "bet",
          refId: bet.id,
          lines: [
            {
              debitAccountId: escrowAcct.id,
              creditAccountId: creatorAcct.id,
              amountUnits: bet.stakeUnits,
              entryType: "BET_REFUND",
              note: `dispute-void-refund-creator:${bet.id}`,
            },
            {
              debitAccountId: escrowAcct.id,
              creditAccountId: opponentAcct.id,
              amountUnits: bet.stakeUnits,
              entryType: "BET_REFUND",
              note: `dispute-void-refund-opponent:${bet.id}`,
            },
          ],
        });
        ledgerTxIds.push(voidLedger.transaction.id);

        const voidUpdate = await tx.bet.updateMany({
          where: { id: bet.id, version: bet.version, status: bet.status },
          data: {
            status: "VOID",
            voidedAt: now,
            version: bet.version + 1,
          },
        });
        if (voidUpdate.count !== 1) {
          throw new BetError(
            "BET_VERSION_MISMATCH",
            `Bet ${bet.id} concurrently mutated`,
            409,
          );
        }
        await tx.betStateTransition.create({
          data: {
            betId: bet.id,
            fromStatus: bet.status,
            toStatus: "VOID",
            actorId: adminId,
            actorType: "ADMIN_DISPUTE_RESOLVE",
            metadata: {
              disputeId,
              outcome: "VOID",
              ledgerTxId: voidLedger.transaction.id,
            },
          },
        });
      }

      const deposit = await disposeDeposit(
        tx,
        dispute,
        bet,
        opener,
        outcome,
        `dispute-deposit-dispose:${disputeId}`,
      );
      if (deposit.ledgerTxId) {
        ledgerTxIds.push(deposit.ledgerTxId);
      }

      const disputeUpdate = await tx.dispute.updateMany({
        where: { id: disputeId, status: dispute.status },
        data: {
          status: "RESOLVED",
          outcome,
          resolvedById: adminId,
          resolvedAt: now,
          adminNotes: adminNotes ?? null,
        },
      });
      if (disputeUpdate.count !== 1) {
        throw new DisputeError(
          "DISPUTE_VERSION_MISMATCH",
          `Dispute ${disputeId} concurrently mutated`,
          409,
        );
      }

      const refreshedDispute = await tx.dispute.findUniqueOrThrow({
        where: { id: disputeId },
      });
      const refreshedBet = await tx.bet.findUniqueOrThrow({
        where: { id: bet.id },
      });

      // P14 hook: DISPUTE_WON/LOST/VOID voor opener
      let repEvent: "DISPUTE_WON" | "DISPUTE_LOST" | "DISPUTE_VOID";
      if (outcome === "VOID") {
        repEvent = "DISPUTE_VOID";
      } else if (
        (outcome === "CREATOR_WINS" && opener.id === bet.createdById) ||
        (outcome === "OPPONENT_WINS" && opener.id === bet.opponentUserId)
      ) {
        repEvent = "DISPUTE_WON";
      } else {
        repEvent = "DISPUTE_LOST";
      }
      await trackReputationEvent({
        tx,
        userId: opener.id,
        eventType: repEvent,
        refType: "dispute",
        refId: disputeId,
      });

      await tx.idempotencyKey.update({
        where: { userId_key: { userId: adminId, key: idempotencyKey } },
        data: {
          responseJson: {
            disputeId,
            betId: bet.id,
            ledgerTxIds,
          },
          statusCode: 200,
          completedAt: new Date(),
        },
      });

      return {
        dispute: refreshedDispute,
        bet: refreshedBet,
        ledgerTxIds,
      };
    },
    { timeout: 30000, maxWait: 5000 },
  );
}

export async function forceCancelBet(
  input: ForceCancelBetInput,
): Promise<ForceCancelBetResult> {
  const { betId, adminId, reason, idempotencyKey } = input;

  if (!isAdmin(adminId)) {
    throw new DisputeError(
      "DISPUTE_NOT_ADMIN",
      `User ${adminId} is not an admin`,
      403,
    );
  }

  if (reason.length < 1 || reason.length > 2000) {
    throw new BetError(
      "BET_INVALID_INPUT",
      "reason must be between 1 and 2000 characters",
      400,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_key: { userId: adminId, key: idempotencyKey } },
      });
      const now = new Date();
      if (
        existingKey?.responseJson &&
        existingKey.expiresAt &&
        existingKey.expiresAt > now
      ) {
        const cached = existingKey.responseJson as {
          betId: string;
          ledgerTxId: string | null;
        };
        const cachedBet = await tx.bet.findUniqueOrThrow({
          where: { id: cached.betId },
        });
        return {
          bet: cachedBet,
          ledgerTxId: cached.ledgerTxId,
        };
      }
      await tx.idempotencyKey.upsert({
        where: { userId_key: { userId: adminId, key: idempotencyKey } },
        create: {
          key: idempotencyKey,
          userId: adminId,
          scope: "force-cancel-bet",
          route: "force-cancel-bet",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
        update: {
          scope: "force-cancel-bet",
          route: "force-cancel-bet",
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });

      await lockBet(tx, betId);
      const bet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });

      const cancelableStatuses: typeof bet.status[] = [
        "DRAFT",
        "OPEN",
        "ACTIVE",
        "RESULT_PROPOSED",
        "AWAITING_CONFIRMATION",
        "DISPUTED",
      ];
      if (!cancelableStatuses.includes(bet.status)) {
        throw new BetError(
          "BET_INVALID_STATUS",
          `Bet ${betId} status ${bet.status} not eligible for force cancel`,
          409,
        );
      }

      const hasOpponent =
        bet.status !== "DRAFT" && bet.status !== "OPEN" && bet.opponentUserId;
      const creatorAcct = await getUserAccount(tx, bet.createdById);
      const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);

      const lines: Parameters<typeof recordTransaction>[0]["lines"] = [
        {
          debitAccountId: escrowAcct.id,
          creditAccountId: creatorAcct.id,
          amountUnits: bet.stakeUnits,
          entryType: "BET_REFUND",
          note: `force-cancel-refund-creator:${bet.id}`,
        },
      ];

      let refundedToOpponent = false;
      if (hasOpponent && bet.opponentUserId) {
        const opponentAcct = await getUserAccount(tx, bet.opponentUserId);
        lines.push({
          debitAccountId: escrowAcct.id,
          creditAccountId: opponentAcct.id,
          amountUnits: bet.stakeUnits,
          entryType: "BET_REFUND",
          note: `force-cancel-refund-opponent:${bet.id}`,
        });
        refundedToOpponent = true;
      }

      const refundLedger = await recordTransaction({
        tx,
        idempotencyKey: `force-cancel:${betId}`,
        description: `Force cancel refund (bet=${bet.id}, admin=${adminId})`,
        initiatorUserId: adminId,
        refType: "bet",
        refId: bet.id,
        lines,
      });
      const ledgerTxId = refundLedger.transaction.id;

      let disputeVoided = false;
      const openDispute = await tx.dispute.findFirst({
        where: {
          betId,
          status: { in: ["OPEN", "EVIDENCE_PHASE", "ADMIN_REVIEW"] },
        },
      });
      if (openDispute) {
        await disposeDeposit(
          tx,
          openDispute,
          bet,
          { id: openDispute.openedById },
          "VOID",
          `dispute-deposit-dispose:force-cancel:${openDispute.id}`,
        );

        const voidUpdate = await tx.dispute.updateMany({
          where: { id: openDispute.id, status: openDispute.status },
          data: {
            status: "RESOLVED",
            outcome: "VOID",
            resolvedById: adminId,
            resolvedAt: now,
            adminNotes: `Auto-voided by force-cancel: ${reason}`,
          },
        });
        if (voidUpdate.count !== 1) {
          throw new DisputeError(
            "DISPUTE_VERSION_MISMATCH",
            `Dispute ${openDispute.id} concurrently mutated`,
            409,
          );
        }
        disputeVoided = true;
      }

      const cancelUpdate = await tx.bet.updateMany({
        where: { id: bet.id, version: bet.version, status: bet.status },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          version: bet.version + 1,
        },
      });
      if (cancelUpdate.count !== 1) {
        throw new BetError(
          "BET_VERSION_MISMATCH",
          `Bet ${bet.id} concurrently mutated`,
          409,
        );
      }

      await tx.betStateTransition.create({
        data: {
          betId: bet.id,
          fromStatus: bet.status,
          toStatus: "CANCELLED",
          actorId: adminId,
          actorType: "ADMIN_FORCE",
          metadata: {
            reason,
            refundedToCreator: true,
            refundedToOpponent,
            disputeVoided,
            ledgerTxId,
          },
        },
      });

      const refreshedBet = await tx.bet.findUniqueOrThrow({
        where: { id: bet.id },
      });

      // P14 hook: FORCE_CANCELLED voor beide participants (audit, delta 0)
      await trackReputationEvent({
        tx,
        userId: refreshedBet.createdById,
        eventType: "FORCE_CANCELLED",
        refType: "bet",
        refId: refreshedBet.id,
      });
      if (hasOpponent && refreshedBet.opponentUserId) {
        await trackReputationEvent({
          tx,
          userId: refreshedBet.opponentUserId,
          eventType: "FORCE_CANCELLED",
          refType: "bet",
          refId: refreshedBet.id,
        });
      }

      await tx.idempotencyKey.update({
        where: { userId_key: { userId: adminId, key: idempotencyKey } },
        data: {
          responseJson: {
            betId: bet.id,
            ledgerTxId,
          },
          statusCode: 200,
          completedAt: new Date(),
        },
      });

      return {
        bet: refreshedBet,
        ledgerTxId,
      };
    },
    { timeout: 30000, maxWait: 5000 },
  );
}
