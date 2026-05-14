import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import type { Bet, Match, Pool, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recordTransaction,
  getUserAccount,
  getExternalAccount,
  type TxClient,
} from "@/lib/ledger";
import {
  createPool,
  publishPool,
  closePool,
} from "@/lib/pools/service";
import {
  addMatchToPool,
  submitMatchResult,
} from "@/lib/matches/service";
import { autoResolveMatchBets } from "@/lib/matches/auto-resolve";
import { createBet, acceptBet } from "@/lib/bets/service";

const SUFFIX = `match-result-${Date.now()}`;
const PRIVY_PREFIX = `mr-${SUFFIX}-`;
const testUserIds: string[] = [];

function newKey(): string {
  return crypto.randomUUID();
}

function deadlineHoursAhead(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
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
    await prisma.$transaction(
      async (tx: TxClient) => {
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
      },
      { timeout: 30_000 },
    );
  }
  return user;
}

async function createPublishedPool(creator: User): Promise<Pool> {
  const created = await createPool({
    creatorId: creator.id,
    title: `Pool ${SUFFIX} ${crypto.randomUUID()}`,
    bettingClosesAt: deadlineHoursAhead(48),
    idempotencyKey: newKey(),
  });
  const published = await publishPool({
    poolId: created.pool.id,
    callerId: creator.id,
    idempotencyKey: newKey(),
  });
  return published.pool;
}

async function addScheduledMatch(
  pool: Pool,
  creator: User,
  label: string = "Match",
): Promise<Match> {
  const r = await addMatchToPool({
    poolId: pool.id,
    callerId: creator.id,
    title: `${label} ${SUFFIX}`,
    idempotencyKey: newKey(),
  });
  return r.match;
}

async function createPoolBet(
  match: Match,
  creator: User,
  opponent: User,
  side: "A" | "B" = "A",
  stake: bigint = 50_000_000n,
): Promise<Bet> {
  const created = await createBet({
    title: "Test bet",
    outcomeA: "A wins",
    outcomeB: "B wins",
    creatorId: creator.id,
    creatorSide: side,
    stakeUnits: stake,
    expiresInHours: 48,
    poolId: match.poolId,
    matchId: match.id,
    idempotencyKey: newKey(),
  });
  const accepted = await acceptBet({
    opponentUserId: opponent.id,
    inviteToken: created.inviteToken!,
    idempotencyKey: newKey(),
  });
  return accepted.bet;
}

async function treasuryBalance(): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: "treasury" },
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
  await prisma.idempotencyKey.deleteMany({
    where: {
      OR: [
        { scope: { startsWith: "pool-" } },
        { scope: { startsWith: "match-" } },
      ],
    },
  });
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
        OR: [{ initiatorUserId: { in: testUserIds } }, { refType: "bet" }],
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

const STAKE = 50_000_000n;
const PLATFORM_FEE_PER_BET = 2_000_000n; // 2% of pot (2 × 50M)

// ── autoResolveMatchBets ─────────────────────────────────────────────

describe("autoResolveMatchBets", () => {
  it("happy 3 bets winnerSide=A — all SETTLED, treasury += 6M", async () => {
    const [pc, c1, c2, c3, o1, o2, o3] = await Promise.all([
      makeUser("ar3-pc", 0n),
      makeUser("ar3-c1"),
      makeUser("ar3-c2"),
      makeUser("ar3-c3"),
      makeUser("ar3-o1"),
      makeUser("ar3-o2"),
      makeUser("ar3-o3"),
    ]);
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    const bets = [
      await createPoolBet(match, c1, o1, "A"),
      await createPoolBet(match, c2, o2, "A"),
      await createPoolBet(match, c3, o3, "A"),
    ];
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    const treasuryBefore = await treasuryBalance();
    const r = await autoResolveMatchBets(match.id, { skipDisputeWindow: true });

    expect(r).toEqual({ resolvedCount: 3, skippedCount: 0 });

    const settled = await prisma.bet.findMany({
      where: { id: { in: bets.map((b) => b.id) } },
    });
    for (const b of settled) {
      expect(b.status).toBe("SETTLED");
      expect(b.winnerId).toBe(b.createdById);
    }

    const settleEntries = await prisma.ledgerEntry.findMany({
      where: {
        transaction: {
          idempotencyKey: { in: bets.map((b) => `bet-settle:${b.id}`) },
        },
      },
    });
    expect(
      settleEntries.filter((e) => e.entryType === "SETTLEMENT_PAYOUT"),
    ).toHaveLength(3);
    expect(
      settleEntries.filter((e) => e.entryType === "FEE_COLLECTION"),
    ).toHaveLength(3);

    expect(await treasuryBalance()).toBe(treasuryBefore + 3n * PLATFORM_FEE_PER_BET);

    const finalMatch = await prisma.match.findUniqueOrThrow({
      where: { id: match.id },
    });
    expect(finalMatch.status).toBe("SETTLED");
  }, 60_000);

  it("mix winners — creator-side A creators win, side B opponents win", async () => {
    const [pc, c1, c2, c3, o1, o2, o3] = await Promise.all([
      makeUser("arx-pc", 0n),
      makeUser("arx-c1"),
      makeUser("arx-c2"),
      makeUser("arx-c3"),
      makeUser("arx-o1"),
      makeUser("arx-o2"),
      makeUser("arx-o3"),
    ]);
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    const betA1 = await createPoolBet(match, c1, o1, "A");
    const betA2 = await createPoolBet(match, c2, o2, "A");
    const betB1 = await createPoolBet(match, c3, o3, "B");
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    await autoResolveMatchBets(match.id, { skipDisputeWindow: true });

    const f1 = await prisma.bet.findUniqueOrThrow({ where: { id: betA1.id } });
    const f2 = await prisma.bet.findUniqueOrThrow({ where: { id: betA2.id } });
    const f3 = await prisma.bet.findUniqueOrThrow({ where: { id: betB1.id } });
    expect(f1.winnerId).toBe(c1.id);
    expect(f2.winnerId).toBe(c2.id);
    expect(f3.winnerId).toBe(o3.id);
  }, 60_000);

  it("skipDisputeWindow=true admin force — works without 24h wait", async () => {
    const pc = await makeUser("ars-pc", 0n);
    const c1 = await makeUser("ars-c1");
    const o1 = await makeUser("ars-o1");
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    const bet = await createPoolBet(match, c1, o1, "A");
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    const r = await autoResolveMatchBets(match.id, { skipDisputeWindow: true });
    expect(r.resolvedCount).toBe(1);
    const finalBet = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(finalBet.status).toBe("SETTLED");
  });

  it("disputeWindow open + skipDisputeWindow=false → MATCH_INVALID_STATUS", async () => {
    const pc = await makeUser("ard-pc", 0n);
    const c1 = await makeUser("ard-c1");
    const o1 = await makeUser("ard-o1");
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    await createPoolBet(match, c1, o1, "A");
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    await expect(
      autoResolveMatchBets(match.id, { skipDisputeWindow: false }),
    ).rejects.toMatchObject({
      code: "MATCH_INVALID_STATUS",
      message: expect.stringMatching(/dispute window still open/),
    });
  });

  it("match with 0 bets → resolvedCount=0, match SETTLED", async () => {
    const pc = await makeUser("ar0-pc", 0n);
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    const r = await autoResolveMatchBets(match.id, { skipDisputeWindow: true });
    expect(r).toEqual({ resolvedCount: 0, skippedCount: 0 });

    const finalMatch = await prisma.match.findUniqueOrThrow({
      where: { id: match.id },
    });
    expect(finalMatch.status).toBe("SETTLED");
  });

  it("race/replay — second call on SETTLED match returns {0,0}", async () => {
    const pc = await makeUser("arr-pc", 0n);
    const c1 = await makeUser("arr-c1");
    const o1 = await makeUser("arr-o1");
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    await createPoolBet(match, c1, o1, "A");
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    const r1 = await autoResolveMatchBets(match.id, { skipDisputeWindow: true });
    expect(r1.resolvedCount).toBe(1);

    const r2 = await autoResolveMatchBets(match.id, { skipDisputeWindow: true });
    expect(r2).toEqual({ resolvedCount: 0, skippedCount: 0 });
  });
});

// ── edge cases ───────────────────────────────────────────────────────

describe("createBet matchId path + settleBet ACTIVE pad", () => {
  it("createBet with matchId attaches to Match (non-creator bettor)", async () => {
    const pc = await makeUser("ec-pc", 0n);
    const c1 = await makeUser("ec-c1");
    const o1 = await makeUser("ec-o1");
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);

    const created = await createBet({
      title: "Test bet",
      outcomeA: "A wins",
      outcomeB: "B wins",
      creatorId: c1.id,
      creatorSide: "A",
      stakeUnits: STAKE,
      expiresInHours: 48,
      poolId: pool.id,
      matchId: match.id,
      idempotencyKey: newKey(),
    });
    const accepted = await acceptBet({
      opponentUserId: o1.id,
      inviteToken: created.inviteToken!,
      idempotencyKey: newKey(),
    });

    expect(accepted.bet.poolId).toBe(pool.id);
    expect(accepted.bet.matchId).toBe(match.id);
    expect(accepted.bet.status).toBe("ACTIVE");
  });

  it("createBet with matchId on CLOSED pool → BET_POOL_MATCH_NOT_OPEN", async () => {
    const pc = await makeUser("ecc-pc", 0n);
    const c1 = await makeUser("ecc-c1");
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    await closePool({
      poolId: pool.id,
      callerId: pc.id,
      idempotencyKey: newKey(),
    });

    await expect(
      createBet({
        title: "Test bet",
        outcomeA: "A wins",
        outcomeB: "B wins",
        creatorId: c1.id,
        creatorSide: "A",
        stakeUnits: STAKE,
        expiresInHours: 48,
        poolId: pool.id,
        matchId: match.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "BET_POOL_MATCH_NOT_OPEN" });
  });

  it("settleBet ACTIVE pad records actorType=POOL_CREATOR_RESOLVE", async () => {
    const pc = await makeUser("ec-act-pc", 0n);
    const c1 = await makeUser("ec-act-c1");
    const o1 = await makeUser("ec-act-o1");
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    const bet = await createPoolBet(match, c1, o1, "A");
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });
    await autoResolveMatchBets(match.id, { skipDisputeWindow: true });

    const transition = await prisma.betStateTransition.findFirst({
      where: { betId: bet.id, toStatus: "SETTLED" },
    });
    expect(transition).not.toBeNull();
    expect(transition!.fromStatus).toBe("ACTIVE");
    expect(transition!.actorType).toBe("POOL_CREATOR_RESOLVE");
    expect(transition!.actorId).toBe(pc.id);
  });

  it("treasury fee aggregation correct after 5 bets — Δ = 10M", async () => {
    const pc = await makeUser("ec-fee-pc", 0n);
    const userPromises: Promise<User>[] = [];
    for (let i = 0; i < 5; i++) {
      userPromises.push(makeUser(`ec-fee-c${i}`));
      userPromises.push(makeUser(`ec-fee-o${i}`));
    }
    const users = await Promise.all(userPromises);
    const creators: User[] = [];
    const opponents: User[] = [];
    for (let i = 0; i < 5; i++) {
      creators.push(users[i * 2]);
      opponents.push(users[i * 2 + 1]);
    }
    const pool = await createPublishedPool(pc);
    const match = await addScheduledMatch(pool, pc);
    for (let i = 0; i < 5; i++) {
      await createPoolBet(match, creators[i], opponents[i], "A", STAKE);
    }
    await submitMatchResult({
      matchId: match.id,
      callerId: pc.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    const before = await treasuryBalance();
    const r = await autoResolveMatchBets(match.id, { skipDisputeWindow: true });
    expect(r.resolvedCount).toBe(5);

    const after = await treasuryBalance();
    expect(after - before).toBe(5n * PLATFORM_FEE_PER_BET);
  }, 90_000);
});
