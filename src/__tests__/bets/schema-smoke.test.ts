import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

const SUFFIX = `bet-schema-${Date.now()}`;
const PRIVY_PREFIX = `bs-${SUFFIX}-`;

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      privyId: `${PRIVY_PREFIX}${label}`,
      email: `${PRIVY_PREFIX}${label}@example.com`,
    },
  });
}

async function cleanup() {
  await prisma.betParticipant.deleteMany({});
  await prisma.bet.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.user.deleteMany({ where: { privyId: { startsWith: PRIVY_PREFIX } } });
}

describe("Bet schema smoke", () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test("Bet creation works with DRAFT default + version 0", async () => {
    const u = await makeUser("creator-1");
    const bet = await prisma.bet.create({
      data: {
        createdById: u.id,
        creatorSide: "A",
        stakeUnits: 50_000_000n,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    expect(bet.status).toBe("DRAFT");
    expect(bet.settlementMode).toBe("PEER_AGREE");
    expect(bet.resultStatus).toBe("PENDING");
    expect(bet.version).toBe(0);
  });

  test("BetParticipant @@unique([betId, side]) blocks dupe", async () => {
    const u1 = await makeUser("p1");
    const u2 = await makeUser("p2");
    const bet = await prisma.bet.create({
      data: {
        createdById: u1.id,
        creatorSide: "A",
        stakeUnits: 10_000_000n,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    await prisma.betParticipant.create({
      data: { betId: bet.id, userId: u1.id, side: "A" },
    });
    await expect(
      prisma.betParticipant.create({
        data: { betId: bet.id, userId: u2.id, side: "A" },
      })
    ).rejects.toThrow();
  });

  test("Pool creator cannot bet on own pool (trigger)", async () => {
    const creator = await makeUser("pool-creator");
    const opponent = await makeUser("pool-opponent");
    const pool = await prisma.pool.create({
      data: {
        createdById: creator.id,
        title: `Test pool ${SUFFIX}`,
        bettingClosesAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    await expect(
      prisma.bet.create({
        data: {
          createdById: creator.id,
          opponentUserId: opponent.id,
          creatorSide: "A",
          stakeUnits: 10_000_000n,
          expiresAt: new Date(Date.now() + 24 * 3600_000),
          poolId: pool.id,
        },
      })
    ).rejects.toThrow(/Pool creator cannot bet on own pool/);
  });

  test("CHECK constraint: matchId requires poolId", async () => {
    const u = await makeUser("check-test");
    const pool = await prisma.pool.create({
      data: {
        createdById: u.id,
        title: `Pool ${SUFFIX}`,
        bettingClosesAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    const match = await prisma.match.create({
      data: { poolId: pool.id, title: "Match A" },
    });
    await expect(
      prisma.$executeRaw`
        INSERT INTO bets (id, created_by_id, creator_side, stake_units, expires_at, match_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${u.id}, 'A', 10000000, NOW() + INTERVAL '1 day', ${match.id}, NOW(), NOW())
      `
    ).rejects.toThrow();
  });
});
