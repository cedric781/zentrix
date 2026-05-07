import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

const SUFFIX = `pool-schema-${Date.now()}`;
const PRIVY_PREFIX = `wd-${SUFFIX}-`;

async function makeUser(label: string) {
  return prisma.user.create({
    data: { privyId: `${PRIVY_PREFIX}${label}-${Math.random()}` },
  });
}

async function makePool(creatorId: string) {
  return prisma.pool.create({
    data: {
      createdByUserId: creatorId,
      title: `test pool ${SUFFIX}`,
      sideALabel: "A",
      sideBLabel: "B",
      bettingClosesAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: "OPEN",
    },
  });
}

describe("pool schema invariants", () => {
  beforeEach(async () => {
    // Order matters: child rows before parents (FKs are ON DELETE RESTRICT,
    // not CASCADE — a Pool with entries cannot be deleted directly).
    await prisma.poolEntry.deleteMany({});
    await prisma.disputeLog.deleteMany({});
    await prisma.settlementJob.deleteMany({});
    await prisma.pool.deleteMany({});
  });

  afterAll(async () => {
    await prisma.poolEntry.deleteMany({});
    await prisma.disputeLog.deleteMany({});
    await prisma.settlementJob.deleteMany({});
    await prisma.pool.deleteMany({});
    // Only delete users this file created — others share the User table.
    await prisma.user.deleteMany({ where: { privyId: { startsWith: PRIVY_PREFIX } } });
    await prisma.$disconnect();
  });

  it("creator-cannot-bet trigger blocks INSERT where user_id == pool.created_by_user_id", async () => {
    const creator = await makeUser("creator-1");
    const pool = await makePool(creator.id);

    await expect(
      prisma.poolEntry.create({
        data: {
          poolId: pool.id,
          userId: creator.id,
          side: "A",
          amountUnits: 1_000_000n,
        },
      }),
    ).rejects.toThrow(/creator-cannot-bet|check_violation/i);

    expect(await prisma.poolEntry.count({ where: { poolId: pool.id } })).toBe(0);
  });

  it("non-creator can place a PoolEntry", async () => {
    const creator = await makeUser("creator-2");
    const bettor = await makeUser("bettor-2");
    const pool = await makePool(creator.id);

    const entry = await prisma.poolEntry.create({
      data: {
        poolId: pool.id,
        userId: bettor.id,
        side: "A",
        amountUnits: 5_000_000n,
      },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.amountUnits).toBe(5_000_000n);
  });

  it("UNIQUE(poolId, userId) blocks duplicate bet by same user", async () => {
    const creator = await makeUser("creator-3");
    const bettor = await makeUser("bettor-3");
    const pool = await makePool(creator.id);

    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: bettor.id, side: "A", amountUnits: 1_000_000n },
    });

    await expect(
      prisma.poolEntry.create({
        data: { poolId: pool.id, userId: bettor.id, side: "B", amountUnits: 2_000_000n },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("SettlementJob.poolId UNIQUE prevents double-settle on same pool", async () => {
    const creator = await makeUser("creator-4");
    const pool = await makePool(creator.id);
    const now = new Date();
    const later = new Date(now.getTime() + 24 * 3600 * 1000);

    await prisma.settlementJob.create({
      data: {
        poolId: pool.id,
        declaredWinner: "A",
        declaredAt: now,
        scheduledFor: later,
      },
    });

    await expect(
      prisma.settlementJob.create({
        data: {
          poolId: pool.id,
          declaredWinner: "B",
          declaredAt: now,
          scheduledFor: later,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("denormalized side totals are recon-detectable when drifted from truth source", async () => {
    const creator = await makeUser("creator-5");
    const b1 = await makeUser("bettor-5a");
    const b2 = await makeUser("bettor-5b");
    const b3 = await makeUser("bettor-5c");
    const pool = await makePool(creator.id);

    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: b1.id, side: "A", amountUnits: 1_000_000n },
    });
    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: b2.id, side: "A", amountUnits: 1_000_000n },
    });
    await prisma.poolEntry.create({
      data: { poolId: pool.id, userId: b3.id, side: "B", amountUnits: 1_000_000n },
    });
    await prisma.pool.update({
      where: { id: pool.id },
      data: {
        totalPotUnits: 3_000_000n,
        totalSideAUnits: 2_000_000n,
        totalSideBUnits: 1_000_000n,
      },
    });

    // Sanity: totals reflect entries before any drift is injected.
    const before = await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } });
    expect(before.totalSideAUnits).toBe(2_000_000n);
    expect(before.totalSideBUnits).toBe(1_000_000n);

    // Inject drift directly into the denormalized total — simulates the
    // exact failure mode the recon engine (PROMPT_13) must catch.
    await prisma.pool.update({
      where: { id: pool.id },
      data: { totalSideAUnits: 99_999_999n },
    });

    // Recon-style aggregation from the truth source.
    // Type via cast rather than $queryRaw<T> generic — the tagged-template
    // generic instantiation crashes tsc on Windows (0xC0000005) when combined
    // with Prisma's heavy client types. The cast preserves the same shape
    // assertion at the use site.
    const rows = (await prisma.$queryRaw`
      SELECT COALESCE(SUM(amount_units), 0)::bigint AS sum
      FROM pool_entries
      WHERE pool_id = ${pool.id} AND side = 'A'
    `) as Array<{ sum: bigint | null }>;
    const aggregateA = rows[0]?.sum ?? 0n;

    const after = await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } });

    expect(aggregateA).toBe(2_000_000n);
    expect(after.totalSideAUnits).toBe(99_999_999n);
    expect(aggregateA).not.toBe(after.totalSideAUnits);
  });
});
