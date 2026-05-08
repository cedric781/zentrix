import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  recordTransaction,
  getUserAccount,
  getExternalAccount,
  type TxClient,
} from "@/lib/ledger";
import { createBet, acceptBet, cancelBet } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";

const SUFFIX = `bet-lifecycle-${Date.now()}`;
const PRIVY_PREFIX = `bl-${SUFFIX}-`;

const testUserIds: string[] = [];

function newKey(): string {
  return crypto.randomUUID();
}

async function makeUser(label: string, fundUnits: bigint = 100_000_000n) {
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
  await prisma.user.deleteMany({
    where: { privyId: { startsWith: PRIVY_PREFIX } },
  });
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

// ── createBet ────────────────────────────────────────────────────────

describe("createBet", () => {
  it("happy path stand-alone — DRAFT then OPEN, ledger balanced", async () => {
    const creator = await makeUser("c-stand-alone");
    const stake = 5_000_000n;
    const startBal = await userBalance(creator.id);

    const result = await createBet({
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: stake,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("OPEN");
    expect(result.bet.version).toBe(1);
    expect(result.bet.poolId).toBeNull();
    expect(result.bet.matchId).toBeNull();
    expect(result.bet.createdByLedgerTxId).not.toBeNull();
    expect(typeof result.inviteToken).toBe("string");
    expect(result.inviteToken).toHaveLength(64);

    const participants = await prisma.betParticipant.findMany({
      where: { betId: result.bet.id },
    });
    expect(participants).toHaveLength(1);
    expect(participants[0].userId).toBe(creator.id);
    expect(participants[0].side).toBe("A");

    const invite = await prisma.betInvite.findUnique({ where: { betId: result.bet.id } });
    expect(invite).not.toBeNull();
    expect(invite!.tokenHash).not.toBe(result.inviteToken!);

    const transitions = await prisma.betStateTransition.findMany({
      where: { betId: result.bet.id },
      orderBy: { createdAt: "asc" },
    });
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromStatus).toBe("DRAFT");
    expect(transitions[0].toStatus).toBe("OPEN");

    expect(await userBalance(creator.id)).toBe(startBal - stake);
    expect(await escrowBalance(result.bet.id)).toBe(stake);
  });

  it("happy path pool-attached — Bet by non-pool-creator works", async () => {
    const poolCreator = await makeUser("c-pc");
    const bettor = await makeUser("c-bettor");
    const pool = await prisma.pool.create({
      data: {
        createdById: poolCreator.id,
        title: `Pool ${SUFFIX}-pool-attached`,
        status: "OPEN",
        bettingClosesAt: new Date(Date.now() + 48 * 3600_000),
      },
    });
    const match = await prisma.match.create({
      data: { poolId: pool.id, title: "Match A" },
    });

    const result = await createBet({
      creatorId: bettor.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      poolId: pool.id,
      matchId: match.id,
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("OPEN");
    expect(result.bet.poolId).toBe(pool.id);
    expect(result.bet.matchId).toBe(match.id);
  });

  it("insufficient balance — BET_INSUFFICIENT_BALANCE, no bet/ledger written", async () => {
    const poor = await makeUser("c-poor", 1_000_000n);
    const beforeBets = await prisma.bet.count({ where: { createdById: poor.id } });
    const beforeBal = await userBalance(poor.id);

    await expect(
      createBet({
        creatorId: poor.id,
        creatorSide: "A",
        stakeUnits: 5_000_000n,
        expiresInHours: 24,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INSUFFICIENT_BALANCE", statusCode: 402 });

    expect(await prisma.bet.count({ where: { createdById: poor.id } })).toBe(beforeBets);
    expect(await userBalance(poor.id)).toBe(beforeBal);
  });

  it("stake out-of-range — BET_INVALID_INPUT for under MIN, over MAX, and zero", async () => {
    const u = await makeUser("c-range");
    const baseInput = {
      creatorId: u.id,
      creatorSide: "A" as const,
      expiresInHours: 24,
    };
    await expect(
      createBet({ ...baseInput, stakeUnits: 100n, idempotencyKey: newKey() }),
    ).rejects.toMatchObject({ code: "BET_INVALID_INPUT" });
    await expect(
      createBet({ ...baseInput, stakeUnits: 100_000_000_000n, idempotencyKey: newKey() }),
    ).rejects.toMatchObject({ code: "BET_INVALID_INPUT" });
    await expect(
      createBet({ ...baseInput, stakeUnits: 0n, idempotencyKey: newKey() }),
    ).rejects.toMatchObject({ code: "BET_INVALID_INPUT" });
  });

  it("idempotent replay — second call returns same bet with inviteToken: null", async () => {
    const u = await makeUser("c-replay");
    const key = newKey();
    const stake = 5_000_000n;
    const balStart = await userBalance(u.id);

    const r1 = await createBet({
      creatorId: u.id,
      creatorSide: "A",
      stakeUnits: stake,
      expiresInHours: 24,
      idempotencyKey: key,
    });
    expect(typeof r1.inviteToken).toBe("string");
    expect(r1.inviteToken).toHaveLength(64);

    const r2 = await createBet({
      creatorId: u.id,
      creatorSide: "A",
      stakeUnits: stake,
      expiresInHours: 24,
      idempotencyKey: key,
    });
    expect(r2.inviteToken).toBeNull();
    expect(r2.bet.id).toBe(r1.bet.id);

    expect(await prisma.bet.count({ where: { createdById: u.id } })).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({
        where: { idempotencyKey: `bet-create:${key}` },
      }),
    ).toBe(1);
    expect(
      await prisma.betInvite.count({ where: { betId: r1.bet.id } }),
    ).toBe(1);
    expect(await userBalance(u.id)).toBe(balStart - stake);
  });
});

// ── acceptBet ────────────────────────────────────────────────────────

describe("acceptBet", () => {
  it("happy path — OPEN to ACTIVE, both holds in escrow", async () => {
    const creator = await makeUser("a-creator");
    const opponent = await makeUser("a-opp");
    const stake = 7_000_000n;
    const oppStart = await userBalance(opponent.id);

    const created = await createBet({
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

    expect(accepted.bet.status).toBe("ACTIVE");
    expect(accepted.bet.opponentUserId).toBe(opponent.id);
    expect(accepted.bet.acceptorSide).toBe("B");
    expect(accepted.bet.version).toBe(2);

    const participants = await prisma.betParticipant.findMany({
      where: { betId: accepted.bet.id },
      orderBy: { side: "asc" },
    });
    expect(participants).toHaveLength(2);
    expect(participants.map((p) => p.userId).sort()).toEqual(
      [creator.id, opponent.id].sort(),
    );

    const invite = await prisma.betInvite.findUnique({ where: { betId: accepted.bet.id } });
    expect(invite!.usedAt).not.toBeNull();
    expect(invite!.usedById).toBe(opponent.id);

    expect(await escrowBalance(accepted.bet.id)).toBe(stake * 2n);
    expect(await userBalance(opponent.id)).toBe(oppStart - stake);

    const transitions = await prisma.betStateTransition.findMany({
      where: { betId: accepted.bet.id },
      orderBy: { createdAt: "asc" },
    });
    expect(transitions.map((t) => t.toStatus)).toEqual(["OPEN", "ACTIVE"]);
  });

  it("bad invite token — BET_INVITE_INVALID", async () => {
    const opp = await makeUser("a-bad-opp");
    const fakeToken = "0".repeat(64);
    await expect(
      acceptBet({
        opponentUserId: opp.id,
        inviteToken: fakeToken,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVITE_INVALID" });
  });

  it("expired invite — BET_INVITE_INVALID", async () => {
    const creator = await makeUser("a-exp-c");
    const opp = await makeUser("a-exp-o");
    const created = await createBet({
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    await prisma.betInvite.update({
      where: { betId: created.bet.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      acceptBet({
        opponentUserId: opp.id,
        inviteToken: created.inviteToken!,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVITE_INVALID" });
  });

  it("self-accept blocked — BET_INVALID_INPUT", async () => {
    const creator = await makeUser("a-self");
    const created = await createBet({
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    await expect(
      acceptBet({
        opponentUserId: creator.id,
        inviteToken: created.inviteToken!,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVALID_INPUT" });
  });

  it("parallel accept × 2 — one wins, one fails with INVALID_STATUS or ALREADY_ACCEPTED", async () => {
    const creator = await makeUser("a-race-c");
    const opp1 = await makeUser("a-race-o1");
    const opp2 = await makeUser("a-race-o2");
    const created = await createBet({
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });

    const settled = await Promise.allSettled([
      acceptBet({
        opponentUserId: opp1.id,
        inviteToken: created.inviteToken!,
        idempotencyKey: newKey(),
      }),
      acceptBet({
        opponentUserId: opp2.id,
        inviteToken: created.inviteToken!,
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
    expect(["BET_INVALID_STATUS", "BET_ALREADY_ACCEPTED"]).toContain(code);

    const finalBet = await prisma.bet.findUniqueOrThrow({ where: { id: created.bet.id } });
    expect(finalBet.status).toBe("ACTIVE");

    const holds = await prisma.ledgerTransaction.count({
      where: { refType: "bet", refId: created.bet.id },
    });
    expect(holds).toBe(2);
  });
});

// ── cancelBet ────────────────────────────────────────────────────────

describe("cancelBet", () => {
  it("happy path OPEN — refund creator, status CANCELLED", async () => {
    const u = await makeUser("ca-creator");
    const stake = 5_000_000n;
    const startBal = await userBalance(u.id);
    const created = await createBet({
      creatorId: u.id,
      creatorSide: "A",
      stakeUnits: stake,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    expect(await userBalance(u.id)).toBe(startBal - stake);

    const cancelled = await cancelBet({
      userId: u.id,
      betId: created.bet.id,
      idempotencyKey: newKey(),
    });
    expect(cancelled.bet.status).toBe("CANCELLED");
    expect(cancelled.bet.cancelledAt).not.toBeNull();
    expect(await userBalance(u.id)).toBe(startBal);
    expect(await escrowBalance(created.bet.id)).toBe(0n);
  });

  it("non-creator — BET_NOT_OWNED_BY_CALLER", async () => {
    const creator = await makeUser("ca-c2");
    const stranger = await makeUser("ca-stranger");
    const created = await createBet({
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    await expect(
      cancelBet({
        userId: stranger.id,
        betId: created.bet.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_NOT_OWNED_BY_CALLER", statusCode: 403 });

    const stillOpen = await prisma.bet.findUniqueOrThrow({ where: { id: created.bet.id } });
    expect(stillOpen.status).toBe("OPEN");
  });

  it("ACTIVE bet — BET_INVALID_STATUS", async () => {
    const creator = await makeUser("ca-active-c");
    const opp = await makeUser("ca-active-o");
    const created = await createBet({
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: 5_000_000n,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    await acceptBet({
      opponentUserId: opp.id,
      inviteToken: created.inviteToken!,
      idempotencyKey: newKey(),
    });
    await expect(
      cancelBet({
        userId: creator.id,
        betId: created.bet.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_INVALID_STATUS" });

    const stillActive = await prisma.bet.findUniqueOrThrow({ where: { id: created.bet.id } });
    expect(stillActive.status).toBe("ACTIVE");
  });

  it("idempotent replay — second call returns same cancelled bet, no second refund", async () => {
    const u = await makeUser("ca-replay");
    const stake = 5_000_000n;
    const startBal = await userBalance(u.id);
    const created = await createBet({
      creatorId: u.id,
      creatorSide: "A",
      stakeUnits: stake,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    const r1 = await cancelBet({
      userId: u.id,
      betId: created.bet.id,
      idempotencyKey: newKey(),
    });
    const r2 = await cancelBet({
      userId: u.id,
      betId: created.bet.id,
      idempotencyKey: newKey(),
    });
    expect(r2.bet.id).toBe(r1.bet.id);
    expect(r2.bet.status).toBe("CANCELLED");
    expect(await userBalance(u.id)).toBe(startBal);
    const refunds = await prisma.ledgerTransaction.count({
      where: { idempotencyKey: `bet-cancel:${created.bet.id}` },
    });
    expect(refunds).toBe(1);
  });
});

// ── trigger ──────────────────────────────────────────────────────────

describe("trigger guard", () => {
  it("pool creator self-bet — BET_CREATOR_BETTING_OWN_POOL", async () => {
    const poolCreator = await makeUser("t-pc");
    const opp = await makeUser("t-opp");
    const pool = await prisma.pool.create({
      data: {
        createdById: poolCreator.id,
        title: `Pool ${SUFFIX}-trigger`,
        status: "OPEN",
        bettingClosesAt: new Date(Date.now() + 48 * 3600_000),
      },
    });
    await expect(
      createBet({
        creatorId: poolCreator.id,
        creatorSide: "A",
        stakeUnits: 5_000_000n,
        expiresInHours: 24,
        poolId: pool.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_CREATOR_BETTING_OWN_POOL", statusCode: 403 });

    const count = await prisma.bet.count({ where: { poolId: pool.id } });
    expect(count).toBe(0);
  });
});
