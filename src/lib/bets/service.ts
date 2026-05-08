import "server-only";
import crypto from "node:crypto";
import { Prisma, type Bet } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recordTransaction,
  getUserAccount,
  lockAccount,
  type TxClient,
} from "@/lib/ledger";
import { getEnv } from "@/lib/env";
import { BetError } from "./errors";
import { getOrCreateBetEscrowAccount } from "./escrow";
import { safeHashCompare } from "@/lib/crypto/safe-compare";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_HEX = /^[0-9a-f]{64}$/;

export interface CreateBetInput {
  creatorId: string;
  creatorSide: "A" | "B";
  stakeUnits: bigint;
  expiresInHours: number;
  poolId?: string;
  matchId?: string;
  idempotencyKey: string;
}

export interface CreateBetResult {
  bet: Bet;
  inviteToken: string | null;
}

export interface AcceptBetInput {
  opponentUserId: string;
  inviteToken: string;
  idempotencyKey: string;
}

export interface AcceptBetResult {
  bet: Bet;
}

export interface CancelBetInput {
  userId: string;
  betId: string;
  idempotencyKey: string;
}

export interface CancelBetResult {
  bet: Bet;
}

// ── helpers ──────────────────────────────────────────────────────────

async function lockBet(tx: TxClient, betId: string): Promise<{ id: string }> {
  const rows = (await tx.$queryRaw`
    SELECT id FROM bets WHERE id = ${betId} FOR UPDATE
  `) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new BetError("BET_NOT_FOUND", `Bet ${betId} not found`, 404);
  }
  return { id: rows[0].id };
}

function isPoolCreatorTriggerError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    typeof e.message === "string" &&
    e.message.includes("Pool creator cannot bet on own pool")
  );
}

function computeTokenHash(plainToken: string): string {
  return crypto.createHash("sha256").update(plainToken).digest("hex");
}

function assertUuidV4(key: string, fieldName: string): void {
  if (!UUID_V4.test(key)) {
    throw new BetError(
      "BET_INVALID_INPUT",
      `${fieldName} must be a UUID v4`,
      400,
    );
  }
}

// ── createBet ────────────────────────────────────────────────────────

export async function createBet(input: CreateBetInput): Promise<CreateBetResult> {
  const {
    creatorId,
    creatorSide,
    stakeUnits,
    expiresInHours,
    poolId,
    matchId,
    idempotencyKey,
  } = input;

  // 1. Cheap input validation.
  assertUuidV4(idempotencyKey, "idempotencyKey");
  if (creatorSide !== "A" && creatorSide !== "B") {
    throw new BetError("BET_INVALID_INPUT", `creatorSide must be "A" or "B"`, 400);
  }
  const env = getEnv();
  if (
    typeof stakeUnits !== "bigint" ||
    stakeUnits < env.BET_MIN_USDC_UNITS ||
    stakeUnits > env.BET_MAX_USDC_UNITS
  ) {
    throw new BetError(
      "BET_INVALID_INPUT",
      `stakeUnits must be in [${env.BET_MIN_USDC_UNITS}, ${env.BET_MAX_USDC_UNITS}]`,
      400,
    );
  }
  if (
    !Number.isInteger(expiresInHours) ||
    expiresInHours < 1 ||
    expiresInHours > 720
  ) {
    throw new BetError("BET_INVALID_INPUT", `expiresInHours must be 1..720`, 400);
  }
  if (matchId && !poolId) {
    throw new BetError(
      "BET_INVALID_INPUT",
      `matchId requires poolId to be set`,
      400,
    );
  }

  // 2. Generate ids + token before tx.
  const betId = crypto.randomUUID();
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = computeTokenHash(inviteToken);
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);
  const ledgerKey = `bet-create:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    // a. Idempotency short-circuit.
    const existingTx = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTx) {
      if (!existingTx.refId) {
        throw new Error(`Idempotent ledger tx ${existingTx.id} has no refId`);
      }
      const replayedBet = await tx.bet.findUnique({ where: { id: existingTx.refId } });
      if (!replayedBet) {
        throw new Error(`Idempotency key bound to missing bet ${existingTx.refId}`);
      }
      return { bet: replayedBet, inviteToken: null };
    }

    // b. Pool / match async validation.
    if (poolId) {
      const pool = await tx.pool.findUnique({ where: { id: poolId } });
      if (!pool) {
        throw new BetError("BET_INVALID_INPUT", `Pool ${poolId} not found`, 400);
      }
      if (pool.status !== "OPEN") {
        throw new BetError(
          "BET_INVALID_STATUS",
          `Pool not accepting bets (status=${pool.status})`,
          409,
        );
      }
      // c. Pool creator pre-check (defense-in-depth voor trigger).
      if (pool.createdById === creatorId) {
        throw new BetError(
          "BET_CREATOR_BETTING_OWN_POOL",
          "Pool creator may not bet on own pool",
          403,
        );
      }
    }
    if (matchId) {
      const match = await tx.match.findUnique({ where: { id: matchId } });
      if (!match || match.poolId !== poolId) {
        throw new BetError("BET_INVALID_INPUT", `Match ${matchId} not in pool ${poolId}`, 400);
      }
      if (match.status !== "SCHEDULED") {
        throw new BetError(
          "BET_INVALID_STATUS",
          `Match not accepting bets (status=${match.status})`,
          409,
        );
      }
    }

    // d. Lock creator account + balance check.
    const userAcct = await getUserAccount(tx, creatorId);
    const locked = await lockAccount(tx, userAcct.id);
    if (locked.balanceUnits < stakeUnits) {
      throw new BetError(
        "BET_INSUFFICIENT_BALANCE",
        `Need ${stakeUnits} units, have ${locked.balanceUnits}`,
        402,
      );
    }

    // e. Insert Bet (DRAFT). Trigger may fire if poolId set.
    let bet: Bet;
    try {
      bet = await tx.bet.create({
        data: {
          id: betId,
          createdById: creatorId,
          creatorSide,
          stakeUnits,
          status: "DRAFT",
          settlementMode: "PROOF_CONFIRM",
          resultStatus: "PENDING",
          version: 0,
          expiresAt,
          poolId: poolId ?? null,
          matchId: matchId ?? null,
        },
      });
    } catch (e) {
      if (isPoolCreatorTriggerError(e)) {
        throw new BetError(
          "BET_CREATOR_BETTING_OWN_POOL",
          "Pool creator may not bet on own pool",
          403,
        );
      }
      throw e;
    }

    // f. Get/create escrow account.
    const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);

    // g. recordTransaction: creator hold.
    const ledgerResult = await recordTransaction({
      tx,
      idempotencyKey: ledgerKey,
      description: `Bet creator hold (bet=${bet.id})`,
      initiatorUserId: creatorId,
      refType: "bet",
      refId: bet.id,
      lines: [
        {
          debitAccountId: userAcct.id,
          creditAccountId: escrowAcct.id,
          amountUnits: stakeUnits,
          entryType: "ESCROW_LOCK",
          note: `bet-hold:${bet.id}:creator`,
        },
      ],
    });

    // h. Insert participant + invite.
    await tx.betParticipant.create({
      data: { betId: bet.id, userId: creatorId, side: creatorSide },
    });
    await tx.betInvite.create({
      data: { betId: bet.id, tokenHash, expiresAt },
    });

    // i. Promote DRAFT → OPEN with version-guard.
    const updated = await tx.bet.updateMany({
      where: { id: bet.id, version: 0, status: "DRAFT" },
      data: {
        status: "OPEN",
        version: 1,
        createdByLedgerTxId: ledgerResult.transaction.id,
      },
    });
    if (updated.count !== 1) {
      throw new BetError(
        "BET_VERSION_MISMATCH",
        `Bet ${bet.id} concurrently mutated`,
        409,
      );
    }

    // j. Audit transition.
    await tx.betStateTransition.create({
      data: {
        betId: bet.id,
        fromStatus: "DRAFT",
        toStatus: "OPEN",
        actorId: creatorId,
        actorType: "USER",
        metadata: { ledgerTxId: ledgerResult.transaction.id },
      },
    });

    const finalBet = await tx.bet.findUniqueOrThrow({ where: { id: bet.id } });
    return { bet: finalBet, inviteToken };
  });
}

// ── acceptBet ────────────────────────────────────────────────────────

export async function acceptBet(input: AcceptBetInput): Promise<AcceptBetResult> {
  const { opponentUserId, inviteToken, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");
  if (!TOKEN_HEX.test(inviteToken)) {
    throw new BetError("BET_INVITE_INVALID", `Invite token format invalid`, 404);
  }

  const tokenHash = computeTokenHash(inviteToken);
  const ledgerKey = `bet-accept:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    // 1. Idempotency short-circuit.
    const existingTx = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTx?.refId) {
      const replayedBet = await tx.bet.findUnique({ where: { id: existingTx.refId } });
      if (replayedBet) return { bet: replayedBet };
    }

    // 2. Find invite by hash.
    const invite = await tx.betInvite.findUnique({ where: { tokenHash } });
    if (!invite) {
      throw new BetError("BET_INVITE_INVALID", "Invite token not recognized", 404);
    }

    // 3. Constant-time compare (belt-and-braces).
    if (!safeHashCompare(invite.tokenHash, tokenHash)) {
      throw new BetError("BET_INVITE_INVALID", "Invite token mismatch", 404);
    }

    // 4. Invite guards.
    if (invite.usedAt !== null) {
      throw new BetError("BET_ALREADY_ACCEPTED", "Invite already used", 409);
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BetError("BET_INVITE_INVALID", "Invite expired", 404);
    }

    // 5. Lock bet row.
    await lockBet(tx, invite.betId);
    const bet = await tx.bet.findUniqueOrThrow({ where: { id: invite.betId } });

    // 6. Bet guards.
    if (bet.status !== "OPEN") {
      throw new BetError(
        "BET_INVALID_STATUS",
        `Bet not accepting (status=${bet.status})`,
        409,
      );
    }
    if (bet.expiresAt.getTime() < Date.now()) {
      throw new BetError("BET_EXPIRED", "Bet accept deadline passed", 409);
    }
    if (bet.createdById === opponentUserId) {
      throw new BetError(
        "BET_INVALID_INPUT",
        "Self-accept blocked: creator cannot accept own bet",
        400,
      );
    }
    if (bet.opponentUserId !== null) {
      throw new BetError("BET_ALREADY_ACCEPTED", "Bet already has opponent", 409);
    }

    // 7. Pool creator pre-check (defense-in-depth voor trigger).
    if (bet.poolId) {
      const pool = await tx.pool.findUnique({ where: { id: bet.poolId } });
      if (pool && pool.createdById === opponentUserId) {
        throw new BetError(
          "BET_CREATOR_BETTING_OWN_POOL",
          "Pool creator may not bet on own pool",
          403,
        );
      }
    }

    // 8. Lock opponent account + balance check.
    const opponentAcct = await getUserAccount(tx, opponentUserId);
    const locked = await lockAccount(tx, opponentAcct.id);
    if (locked.balanceUnits < bet.stakeUnits) {
      throw new BetError(
        "BET_INSUFFICIENT_BALANCE",
        `Need ${bet.stakeUnits} units, have ${locked.balanceUnits}`,
        402,
      );
    }

    // 9. Bet escrow exists already (created in createBet).
    const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);

    const acceptorSide: "A" | "B" = bet.creatorSide === "A" ? "B" : "A";

    // 10. recordTransaction: opponent hold.
    let ledgerResult;
    try {
      ledgerResult = await recordTransaction({
        tx,
        idempotencyKey: ledgerKey,
        description: `Bet opponent hold (bet=${bet.id})`,
        initiatorUserId: opponentUserId,
        refType: "bet",
        refId: bet.id,
        lines: [
          {
            debitAccountId: opponentAcct.id,
            creditAccountId: escrowAcct.id,
            amountUnits: bet.stakeUnits,
            entryType: "ESCROW_LOCK",
            note: `bet-hold:${bet.id}:opponent`,
          },
        ],
      });
    } catch (e) {
      if (isPoolCreatorTriggerError(e)) {
        throw new BetError(
          "BET_CREATOR_BETTING_OWN_POOL",
          "Pool creator may not bet on own pool",
          403,
        );
      }
      throw e;
    }

    // 11. Promote OPEN → ACTIVE with version-guard.
    let updated;
    try {
      updated = await tx.bet.updateMany({
        where: { id: bet.id, version: bet.version, status: "OPEN" },
        data: {
          status: "ACTIVE",
          version: bet.version + 1,
          opponentUserId,
          acceptorSide,
        },
      });
    } catch (e) {
      if (isPoolCreatorTriggerError(e)) {
        throw new BetError(
          "BET_CREATOR_BETTING_OWN_POOL",
          "Pool creator may not bet on own pool",
          403,
        );
      }
      throw e;
    }
    if (updated.count !== 1) {
      throw new BetError(
        "BET_VERSION_MISMATCH",
        `Bet ${bet.id} concurrently mutated`,
        409,
      );
    }

    // 12. Mark invite used + insert participant.
    await tx.betInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedById: opponentUserId },
    });
    await tx.betParticipant.create({
      data: { betId: bet.id, userId: opponentUserId, side: acceptorSide },
    });

    // 13. Audit transition.
    await tx.betStateTransition.create({
      data: {
        betId: bet.id,
        fromStatus: "OPEN",
        toStatus: "ACTIVE",
        actorId: opponentUserId,
        actorType: "USER",
        metadata: { ledgerTxId: ledgerResult.transaction.id },
      },
    });

    const finalBet = await tx.bet.findUniqueOrThrow({ where: { id: bet.id } });
    return { bet: finalBet };
  });
}

// ── cancelBet ────────────────────────────────────────────────────────

export async function cancelBet(input: CancelBetInput): Promise<CancelBetResult> {
  const { userId, betId, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");
  const ledgerKey = `bet-cancel:${betId}`;

  return await prisma.$transaction(async (tx) => {
    // 1. Idempotency short-circuit.
    const existingTx = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existingTx?.refId) {
      const replayedBet = await tx.bet.findUnique({ where: { id: existingTx.refId } });
      if (replayedBet) return { bet: replayedBet };
    }

    // 2. Lock bet row.
    await lockBet(tx, betId);
    const bet = await tx.bet.findUniqueOrThrow({ where: { id: betId } });

    // 3. Guards.
    if (bet.createdById !== userId) {
      throw new BetError(
        "BET_NOT_OWNED_BY_CALLER",
        "Only the bet creator can cancel",
        403,
      );
    }
    if (bet.status !== "OPEN" && bet.status !== "DRAFT") {
      throw new BetError(
        "BET_INVALID_STATUS",
        `Cannot cancel from status=${bet.status}`,
        409,
      );
    }

    // 4. Lock accounts + refund.
    const userAcct = await getUserAccount(tx, userId);
    await lockAccount(tx, userAcct.id);
    const escrowAcct = await getOrCreateBetEscrowAccount(tx, bet.id);

    const ledgerResult = await recordTransaction({
      tx,
      idempotencyKey: ledgerKey,
      description: `Bet cancellation refund (bet=${bet.id})`,
      initiatorUserId: userId,
      refType: "bet",
      refId: bet.id,
      lines: [
        {
          debitAccountId: escrowAcct.id,
          creditAccountId: userAcct.id,
          amountUnits: bet.stakeUnits,
          entryType: "ESCROW_RELEASE",
          note: `bet-cancel-refund:${bet.id}`,
        },
      ],
    });

    // 5. Status → CANCELLED with version-guard.
    const fromStatus = bet.status;
    const updated = await tx.bet.updateMany({
      where: { id: bet.id, version: bet.version, status: fromStatus },
      data: {
        status: "CANCELLED",
        version: bet.version + 1,
        cancelledAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new BetError(
        "BET_VERSION_MISMATCH",
        `Bet ${bet.id} concurrently mutated`,
        409,
      );
    }

    // 6. Audit transition.
    await tx.betStateTransition.create({
      data: {
        betId: bet.id,
        fromStatus,
        toStatus: "CANCELLED",
        actorId: userId,
        actorType: "USER",
        metadata: { ledgerTxId: ledgerResult.transaction.id },
      },
    });

    const finalBet = await tx.bet.findUniqueOrThrow({ where: { id: bet.id } });
    return { bet: finalBet };
  });
}
