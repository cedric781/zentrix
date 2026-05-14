import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import type { Bet, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recordTransaction,
  getUserAccount,
  getExternalAccount,
  type TxClient,
} from "@/lib/ledger";
import {
  createBet,
  acceptBet,
  proposeResult,
  confirmResult,
} from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";

const SUFFIX = `bet-settlement-${Date.now()}`;
const PRIVY_PREFIX = `bs-${SUFFIX}-`;

const testUserIds: string[] = [];

function newKey(): string {
  return crypto.randomUUID();
}

async function makeUser(label: string, fundUnits: bigint = 200_000_000n) {
  const user = await prisma.user.create({
    data: {
      privyId: `${PRIVY_PREFIX}${label}`,
      email: `${PRIVY_PREFIX}${label}@example.com`,
    },
  });
  testUserIds.push(user.id);

  if (fundUnits > 0n) {
    await prisma.$transaction(async (tx: TxClient) => {
      const userAcct = await getUserAccount(tx, user.id);
      const ext = await getExternalAccount(tx);
      await recordTransaction({
        tx,
        idempotencyKey: `test-fund:${user.id}`,
        description: `Test funding for ${user.privyId}`,
        initiatorUserId: user.id,
        refType: "test",
        refId: user.id,
        lines: [
          {
            debitAccountId: ext.id,
            creditAccountId: userAcct.id,
            amountUnits: fundUnits,
            entryType: "DEPOSIT_CREDIT",
            note: "test-funding",
          },
        ],
      });
    });
  }
  return user;
}

async function userBalance(userId: string): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: `user:${userId}` },
  });
  return acct?.balanceUnits ?? 0n;
}

async function escrowBalance(betId: string): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: `bet:${betId}` },
  });
  return acct?.balanceUnits ?? 0n;
}

async function treasuryBalance(): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: "treasury" },
  });
  return acct?.balanceUnits ?? 0n;
}

async function createAcceptedBet(
  creator: User,
  opponent: User,
  stake: bigint = 50_000_000n,
): Promise<Bet> {
  const created = await createBet({
    title: "Test bet",
    outcomeA: "A wins",
    outcomeB: "B wins",
    creatorId: creator.id,
    creatorSide: "A",
    stakeUnits: stake,
    expiresInHours: 24,
    idempotencyKey: newKey(),
  });
  const accepted = await acceptBet({
    opponentUserId: opponent.id,
    inviteToken: created.inviteToken!,
    idempotencyKey: newKey(),
  });
  return accepted.bet;
}

async function fullCleanup() {
  await prisma.betStateTransition.deleteMany({});
  await prisma.betParticipantConfirmation.deleteMany({});
  await prisma.betResultClaim.deleteMany({});
  await prisma.betEvidence.deleteMany({});
  await prisma.betParticipant.deleteMany({});
  await prisma.betInvite.deleteMany({});
  await prisma.bet.deleteMany({});
  await prisma.matchEvidence.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.pool.deleteMany({});
  if (testUserIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        OR: [
          { transaction: { initiatorUserId: { in: testUserIds } } },
          { debitAccount: { scopeKey: { startsWith: "bet:" } } },
          { creditAccount: { scopeKey: { startsWith: "bet:" } } },
        ],
      },
    });
    await prisma.ledgerTransaction.deleteMany({
      where: {
        OR: [
          { initiatorUserId: { in: testUserIds } },
          { refType: "bet" },
        ],
      },
    });
  }
  await prisma.financialAccount.deleteMany({
    where: {
      OR: [
        { userId: { in: testUserIds } },
        { scopeKey: { startsWith: "bet:" } },
      ],
    },
  });
  await prisma.reputationEvent.deleteMany({
    where: { user: { privyId: { startsWith: PRIVY_PREFIX } } },
  });
  await prisma.userReputation.deleteMany({
    where: { user: { privyId: { startsWith: PRIVY_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { privyId: { startsWith: PRIVY_PREFIX } },
  });
  // Reset singleton balances so downstream tests asserting treasury == 0n stay green.
  await prisma.financialAccount.updateMany({
    where: { scopeKey: { in: ["treasury", "external"] } },
    data: { balanceUnits: 0n },
  });
}

beforeAll(async () => {
  await fullCleanup();
});

afterAll(async () => {
  await fullCleanup();
  await prisma.$disconnect();
});

// ── proposeResult ────────────────────────────────────────────────────

describe("proposeResult", () => {
  it("happy path creator claims self winner", async () => {
    const creator = await makeUser("p-c1");
    const opponent = await makeUser("p-o1");
    const bet = await createAcceptedBet(creator, opponent);

    const result = await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("RESULT_PROPOSED");
    expect(result.bet.resultStatus).toBe("PROPOSED");
    expect(result.bet.winnerId).toBe(creator.id);
    expect(result.bet.confirmDeadline).not.toBeNull();
    expect(result.bet.confirmDeadline!.getTime()).toBeGreaterThan(Date.now());

    expect(result.claim.claimedById).toBe(creator.id);
    expect(result.claim.claimedWinnerId).toBe(creator.id);

    const transitions = await prisma.betStateTransition.findMany({
      where: { betId: bet.id },
      orderBy: { createdAt: "asc" },
    });
    expect(transitions.map((t) => t.toStatus)).toEqual([
      "OPEN",
      "ACTIVE",
      "RESULT_PROPOSED",
    ]);
  });

  it("happy path opponent claims self winner", async () => {
    const creator = await makeUser("p-c2");
    const opponent = await makeUser("p-o2");
    const bet = await createAcceptedBet(creator, opponent);

    const result = await proposeResult({
      betId: bet.id,
      callerId: opponent.id,
      claimedWinnerId: opponent.id,
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("RESULT_PROPOSED");
    expect(result.bet.winnerId).toBe(opponent.id);
  });

  it("non-participant cannot claim", async () => {
    const creator = await makeUser("p-c3");
    const opponent = await makeUser("p-o3");
    const stranger = await makeUser("p-stranger");
    const bet = await createAcceptedBet(creator, opponent);

    await expect(
      proposeResult({
        betId: bet.id,
        callerId: stranger.id,
        claimedWinnerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_NOT_PARTICIPANT", statusCode: 403 });

    const stillActive = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(stillActive.status).toBe("ACTIVE");
    expect(await prisma.betResultClaim.count({ where: { betId: bet.id } })).toBe(0);
  });

  it("rejects when bet not ACTIVE (CANCELLED)", async () => {
    const creator = await makeUser("p-c4");
    const created = await createBet({
      title: "Test bet",
      outcomeA: "A wins",
      outcomeB: "B wins",
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    // Cancel via direct status mutation to simulate CANCELLED bet.
    await prisma.bet.update({
      where: { id: created.bet.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await expect(
      proposeResult({
        betId: created.bet.id,
        callerId: creator.id,
        claimedWinnerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVALID_STATUS" });
  });

  it("idempotent replay returns existing claim silent-success", async () => {
    const creator = await makeUser("p-c5");
    const opponent = await makeUser("p-o5");
    const bet = await createAcceptedBet(creator, opponent);

    const r1 = await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });
    const r2 = await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: opponent.id, // different winner — should be ignored on replay
      idempotencyKey: newKey(),
    });

    expect(r2.claim.id).toBe(r1.claim.id);
    expect(r2.claim.claimedWinnerId).toBe(creator.id); // first claim's value persisted
    expect(
      await prisma.betResultClaim.count({ where: { betId: bet.id } }),
    ).toBe(1);
  });
});

// ── confirmResult — CONFIRM_WINNER ────────────────────────────────────

describe("confirmResult CONFIRM_WINNER", () => {
  it("happy path settles bet, ledger balanced", async () => {
    const creator = await makeUser("cw-c1");
    const opponent = await makeUser("cw-o1");
    const bet = await createAcceptedBet(creator, opponent);

    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });
    const confirmed = await confirmResult({
      betId: bet.id,
      callerId: opponent.id,
      decision: "CONFIRM_WINNER",
      idempotencyKey: newKey(),
    });

    expect(confirmed.bet.status).toBe("SETTLED");
    expect(confirmed.bet.resultStatus).toBe("CONFIRMED");
    expect(confirmed.bet.settledAt).not.toBeNull();

    const participants = await prisma.betParticipant.findMany({ where: { betId: bet.id } });
    expect(participants.every((p) => p.hasConfirmed)).toBe(true);

    expect(await escrowBalance(bet.id)).toBe(0n);

    const transitions = await prisma.betStateTransition.findMany({
      where: { betId: bet.id },
      orderBy: { createdAt: "asc" },
    });
    expect(transitions.map((t) => t.toStatus)).toEqual([
      "OPEN",
      "ACTIVE",
      "RESULT_PROPOSED",
      "SETTLED",
    ]);
  });

  it("ledger math: 50 USDC stake, 100 USDC pot, 2 USDC fee, 98 USDC payout", async () => {
    const creator = await makeUser("cw-c2");
    const opponent = await makeUser("cw-o2");
    const stake = 50_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);

    const creatorStartBal = await userBalance(creator.id);
    const treasuryStartBal = await treasuryBalance();

    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });
    await confirmResult({
      betId: bet.id,
      callerId: opponent.id,
      decision: "CONFIRM_WINNER",
      idempotencyKey: newKey(),
    });

    const winnerEnd = await userBalance(creator.id);
    const treasuryEnd = await treasuryBalance();

    expect(winnerEnd - creatorStartBal).toBe(98_000_000n);
    expect(treasuryEnd - treasuryStartBal).toBe(2_000_000n);
    expect(await escrowBalance(bet.id)).toBe(0n);
  });

  it("idempotent replay returns existing confirmation silent-success", async () => {
    const creator = await makeUser("cw-c3");
    const opponent = await makeUser("cw-o3");
    const bet = await createAcceptedBet(creator, opponent);

    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });
    const r1 = await confirmResult({
      betId: bet.id,
      callerId: opponent.id,
      decision: "CONFIRM_WINNER",
      idempotencyKey: newKey(),
    });
    const balAfterFirst = await userBalance(creator.id);

    const r2 = await confirmResult({
      betId: bet.id,
      callerId: opponent.id,
      decision: "CONFIRM_WINNER",
      idempotencyKey: newKey(),
    });

    expect(r2.confirmation.id).toBe(r1.confirmation.id);
    expect(r2.bet.status).toBe("SETTLED");
    expect(await userBalance(creator.id)).toBe(balAfterFirst);
    expect(
      await prisma.betParticipantConfirmation.count({ where: { betId: bet.id } }),
    ).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({
        where: { idempotencyKey: `bet-settle:${bet.id}` },
      }),
    ).toBe(1);
  });

  it("claimant cannot confirm own claim", async () => {
    const creator = await makeUser("cw-c4");
    const opponent = await makeUser("cw-o4");
    const bet = await createAcceptedBet(creator, opponent);
    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });

    await expect(
      confirmResult({
        betId: bet.id,
        callerId: creator.id,
        decision: "CONFIRM_WINNER",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_CONFIRM_BY_CLAIMANT", statusCode: 403 });

    const stillProposed = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(stillProposed.status).toBe("RESULT_PROPOSED");
  });

  it("BET_RESULT_CLAIM_NOT_FOUND if status forced to RESULT_PROPOSED without claim", async () => {
    const creator = await makeUser("cw-c5");
    const opponent = await makeUser("cw-o5");
    const bet = await createAcceptedBet(creator, opponent);
    await prisma.bet.update({
      where: { id: bet.id },
      data: {
        status: "RESULT_PROPOSED",
        resultStatus: "PROPOSED",
        confirmDeadline: new Date(Date.now() + 24 * 3600_000),
      },
    });

    await expect(
      confirmResult({
        betId: bet.id,
        callerId: opponent.id,
        decision: "CONFIRM_WINNER",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_RESULT_CLAIM_NOT_FOUND", statusCode: 404 });
  });
});

// ── confirmResult — DISAGREE ─────────────────────────────────────────

describe("confirmResult DISAGREE", () => {
  it("happy path disagrees, status DISPUTED, no ledger movement", async () => {
    const creator = await makeUser("d-c1");
    const opponent = await makeUser("d-o1");
    const bet = await createAcceptedBet(creator, opponent);
    const escrowStart = await escrowBalance(bet.id);

    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });
    const result = await confirmResult({
      betId: bet.id,
      callerId: opponent.id,
      decision: "DISAGREE",
      claimedWinnerId: opponent.id,
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("DISPUTED");
    expect(result.bet.resultStatus).toBe("DISPUTED");
    expect(result.confirmation.decision).toBe("DISAGREE");
    expect(result.confirmation.claimedWinnerId).toBe(opponent.id);
    expect(await escrowBalance(bet.id)).toBe(escrowStart);
  });

  it("DISAGREE without claimedWinnerId rejected", async () => {
    const creator = await makeUser("d-c2");
    const opponent = await makeUser("d-o2");
    const bet = await createAcceptedBet(creator, opponent);
    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });

    await expect(
      confirmResult({
        betId: bet.id,
        callerId: opponent.id,
        decision: "DISAGREE",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVALID_INPUT" });
  });

  it("DISAGREE with same winner as claim rejected", async () => {
    const creator = await makeUser("d-c3");
    const opponent = await makeUser("d-o3");
    const bet = await createAcceptedBet(creator, opponent);
    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id, // claim says creator wins
      idempotencyKey: newKey(),
    });

    await expect(
      confirmResult({
        betId: bet.id,
        callerId: opponent.id,
        decision: "DISAGREE",
        claimedWinnerId: creator.id, // disagrees but picks same winner
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVALID_INPUT" });
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe("Settlement edge cases", () => {
  it("pool-attached bet rejected by proposeResult", async () => {
    const poolCreator = await makeUser("e-pc");
    const creator = await makeUser("e-c");
    const opponent = await makeUser("e-o");
    const pool = await prisma.pool.create({
      data: {
        createdById: poolCreator.id,
        title: `Pool ${SUFFIX}-edge-pool`,
        status: "OPEN",
        bettingClosesAt: new Date(Date.now() + 48 * 3600_000),
      },
    });
    const match = await prisma.match.create({
      data: { poolId: pool.id, title: "Match X" },
    });
    const created = await createBet({
      title: "Test bet",
      outcomeA: "A wins",
      outcomeB: "B wins",
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      poolId: pool.id,
      matchId: match.id,
      idempotencyKey: newKey(),
    });
    await acceptBet({
      opponentUserId: opponent.id,
      inviteToken: created.inviteToken!,
      idempotencyKey: newKey(),
    });

    await expect(
      proposeResult({
        betId: created.bet.id,
        callerId: creator.id,
        claimedWinnerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      code: "BET_INVALID_STATUS",
    });
  });

  it("settled bet cannot be re-claimed", async () => {
    const creator = await makeUser("e-set-c");
    const opponent = await makeUser("e-set-o");
    const bet = await createAcceptedBet(creator, opponent);
    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });
    await confirmResult({
      betId: bet.id,
      callerId: opponent.id,
      decision: "CONFIRM_WINNER",
      idempotencyKey: newKey(),
    });

    await expect(
      proposeResult({
        betId: bet.id,
        callerId: opponent.id,
        claimedWinnerId: opponent.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVALID_STATUS" });
  });

  it("cancelled bet cannot be claimed", async () => {
    const creator = await makeUser("e-can-c");
    const created = await createBet({
      title: "Test bet",
      outcomeA: "A wins",
      outcomeB: "B wins",
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    await prisma.bet.update({
      where: { id: created.bet.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await expect(
      proposeResult({
        betId: created.bet.id,
        callerId: creator.id,
        claimedWinnerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVALID_STATUS" });
  });

  it("parallel proposeResult: one wins, one rejected", async () => {
    const creator = await makeUser("e-race-c");
    const opponent = await makeUser("e-race-o");
    const bet = await createAcceptedBet(creator, opponent);

    const settled = await Promise.allSettled([
      proposeResult({
        betId: bet.id,
        callerId: creator.id,
        claimedWinnerId: creator.id,
        idempotencyKey: newKey(),
      }),
      proposeResult({
        betId: bet.id,
        callerId: opponent.id,
        claimedWinnerId: opponent.id,
        idempotencyKey: newKey(),
      }),
    ]);

    const succeeded = settled.filter((r) => r.status === "fulfilled");
    const failed = settled.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const failure = failed[0] as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(BetError);
    const code = (failure.reason as BetError).code;
    expect(["BET_INVALID_STATUS", "BET_RESULT_ALREADY_CLAIMED"]).toContain(code);

    expect(
      await prisma.betResultClaim.count({ where: { betId: bet.id } }),
    ).toBe(1);
  });

  it("confirmDeadline passed → BET_DEADLINE_PASSED on confirmResult", async () => {
    const creator = await makeUser("e-dl-c");
    const opponent = await makeUser("e-dl-o");
    const bet = await createAcceptedBet(creator, opponent);
    await proposeResult({
      betId: bet.id,
      callerId: creator.id,
      claimedWinnerId: creator.id,
      idempotencyKey: newKey(),
    });
    await prisma.bet.update({
      where: { id: bet.id },
      data: { confirmDeadline: new Date(Date.now() - 1000) },
    });

    await expect(
      confirmResult({
        betId: bet.id,
        callerId: opponent.id,
        decision: "CONFIRM_WINNER",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_DEADLINE_PASSED" });
  });
});
