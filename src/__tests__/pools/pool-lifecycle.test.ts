import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createPool,
  publishPool,
  closePool,
  cancelPool,
} from "@/lib/pools/lifecycle";
import type { CreatePoolInput } from "@/lib/pools/lifecycle";

const SUFFIX = `pool-lifecycle-${Date.now()}`;
const PRIVY_PREFIX = `wd-${SUFFIX}-`;

async function makeUser(label: string) {
  return prisma.user.create({
    data: { privyId: `${PRIVY_PREFIX}${label}-${Math.random()}` },
  });
}

function validInput(
  creatorId: string,
  overrides: Partial<CreatePoolInput> = {},
): CreatePoolInput {
  return {
    creatorId,
    title: `Test pool ${SUFFIX}`,
    description: "Test description",
    sideALabel: "YES",
    sideBLabel: "NO",
    bettingClosesAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    creatorFeeBps: 200,
    ...overrides,
  };
}

describe("pool lifecycle services", () => {
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
    await prisma.user.deleteMany({
      where: { privyId: { startsWith: PRIVY_PREFIX } },
    });
    await prisma.$disconnect();
  });

  // ── createPool (5) ─────────────────────────────────────────────

  it("createPool creates DRAFT row with all fields populated", async () => {
    const creator = await makeUser("c1");
    const input = validInput(creator.id);
    const pool = await createPool(input);

    expect(pool.id).toBeTruthy();
    expect(pool.status).toBe("DRAFT");
    expect(pool.createdByUserId).toBe(creator.id);
    expect(pool.title).toBe(input.title);
    expect(pool.description).toBe("Test description");
    expect(pool.sideALabel).toBe("YES");
    expect(pool.sideBLabel).toBe("NO");
    expect(pool.creatorFeeBps).toBe(200);
    expect(pool.totalPotUnits).toBe(0n);
    expect(pool.totalSideAUnits).toBe(0n);
    expect(pool.totalSideBUnits).toBe(0n);
    expect(pool.publishedAt).toBeNull();
    expect(pool.closedAt).toBeNull();
  });

  it("createPool rejects empty/whitespace title with POOL_TITLE_INVALID 400", async () => {
    const creator = await makeUser("c2");
    await expect(
      createPool(validInput(creator.id, { title: "   " })),
    ).rejects.toMatchObject({
      code: "POOL_TITLE_INVALID",
      statusCode: 400,
    });
  });

  it("createPool rejects identical sideA/sideB labels case-insensitive with POOL_SIDES_INVALID 400", async () => {
    const creator = await makeUser("c3");
    await expect(
      createPool(
        validInput(creator.id, { sideALabel: "YES", sideBLabel: "yes" }),
      ),
    ).rejects.toMatchObject({
      code: "POOL_SIDES_INVALID",
      statusCode: 400,
    });
  });

  it("createPool rejects bettingClosesAt < 1h ahead with POOL_DEADLINE_INVALID 400", async () => {
    const creator = await makeUser("c4");
    await expect(
      createPool(
        validInput(creator.id, {
          bettingClosesAt: new Date(Date.now() + 30 * 60 * 1000),
        }),
      ),
    ).rejects.toMatchObject({
      code: "POOL_DEADLINE_INVALID",
      statusCode: 400,
    });
  });

  it("createPool rejects creatorFeeBps out of range with POOL_CREATOR_FEE_OUT_OF_RANGE 400", async () => {
    const creator = await makeUser("c5");
    await expect(
      createPool(validInput(creator.id, { creatorFeeBps: 9999 })),
    ).rejects.toMatchObject({
      code: "POOL_CREATOR_FEE_OUT_OF_RANGE",
      statusCode: 400,
    });
  });

  // ── publishPool (3) ────────────────────────────────────────────

  it("publishPool DRAFT -> OPEN sets status and publishedAt timestamp", async () => {
    const creator = await makeUser("c6");
    const pool = await createPool(validInput(creator.id));
    const before = Date.now();
    const published = await publishPool({
      poolId: pool.id,
      creatorId: creator.id,
    });
    const after = Date.now();

    expect(published.status).toBe("OPEN");
    expect(published.publishedAt).not.toBeNull();
    const ts = published.publishedAt!.getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 5000);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it("publishPool rejects non-creator caller with POOL_NOT_OWNED_BY_CALLER 403", async () => {
    const creator = await makeUser("c7-creator");
    const stranger = await makeUser("c7-stranger");
    const pool = await createPool(validInput(creator.id));
    await expect(
      publishPool({ poolId: pool.id, creatorId: stranger.id }),
    ).rejects.toMatchObject({
      code: "POOL_NOT_OWNED_BY_CALLER",
      statusCode: 403,
    });
  });

  it("publishPool rejects re-publish of OPEN pool with POOL_INVALID_STATUS 409", async () => {
    const creator = await makeUser("c8");
    const pool = await createPool(validInput(creator.id));
    await publishPool({ poolId: pool.id, creatorId: creator.id });
    await expect(
      publishPool({ poolId: pool.id, creatorId: creator.id }),
    ).rejects.toMatchObject({
      code: "POOL_INVALID_STATUS",
      statusCode: 409,
    });
  });

  // ── closePool (1 happy + 1 extra) ──────────────────────────────

  it("closePool OPEN -> CLOSED with by=system sets status and closedAt timestamp", async () => {
    const creator = await makeUser("c9");
    const pool = await createPool(validInput(creator.id));
    await publishPool({ poolId: pool.id, creatorId: creator.id });
    const before = Date.now();
    const closed = await closePool({ poolId: pool.id, by: "system" });
    const after = Date.now();

    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
    const ts = closed.closedAt!.getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 5000);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it("closePool rejects non-OPEN (DRAFT) pool with POOL_INVALID_STATUS 409", async () => {
    const creator = await makeUser("c12");
    const pool = await createPool(validInput(creator.id));
    await expect(
      closePool({ poolId: pool.id, by: "creator" }),
    ).rejects.toMatchObject({
      code: "POOL_INVALID_STATUS",
      statusCode: 409,
    });
  });

  // ── cancelPool (2 spec + 2 extra) ──────────────────────────────

  it("cancelPool DRAFT -> CANCELLED happy path", async () => {
    const creator = await makeUser("c10");
    const pool = await createPool(validInput(creator.id));
    const cancelled = await cancelPool({
      poolId: pool.id,
      creatorId: creator.id,
    });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("cancelPool rejects non-DRAFT (OPEN) pool with POOL_HAS_BETS_CANNOT_CANCEL 409", async () => {
    const creator = await makeUser("c11");
    const pool = await createPool(validInput(creator.id));
    await publishPool({ poolId: pool.id, creatorId: creator.id });
    await expect(
      cancelPool({ poolId: pool.id, creatorId: creator.id }),
    ).rejects.toMatchObject({
      code: "POOL_HAS_BETS_CANNOT_CANCEL",
      statusCode: 409,
    });
  });

  it("cancelPool rejects non-creator caller with POOL_NOT_OWNED_BY_CALLER 403", async () => {
    const creator = await makeUser("c13-creator");
    const stranger = await makeUser("c13-stranger");
    const pool = await createPool(validInput(creator.id));
    await expect(
      cancelPool({ poolId: pool.id, creatorId: stranger.id }),
    ).rejects.toMatchObject({
      code: "POOL_NOT_OWNED_BY_CALLER",
      statusCode: 403,
    });
  });

  it("cancelPool returns POOL_NOT_FOUND for non-existent UUID", async () => {
    const stranger = await makeUser("c14");
    await expect(
      cancelPool({
        poolId: "00000000-0000-0000-0000-000000000000",
        creatorId: stranger.id,
      }),
    ).rejects.toMatchObject({
      code: "POOL_NOT_FOUND",
      statusCode: 404,
    });
  });
});
