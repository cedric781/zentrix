import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  createPool,
  publishPool,
  closePool,
  cancelPool,
} from "@/lib/pools/service";
import { PoolError } from "@/lib/pools/errors";

const SUFFIX = `pool-lifecycle-${Date.now()}`;
const PRIVY_PREFIX = `pl-${SUFFIX}-`;
const testUserIds: string[] = [];

function newKey(): string {
  return crypto.randomUUID();
}

function deadlineHoursAhead(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: {
      privyId: `${PRIVY_PREFIX}${label}`,
      email: `${PRIVY_PREFIX}${label}@example.com`,
    },
  });
  testUserIds.push(user.id);
  return user;
}

async function fullCleanup() {
  await prisma.betStateTransition.deleteMany({});
  await prisma.betParticipantConfirmation.deleteMany({});
  await prisma.betResultClaim.deleteMany({});
  await prisma.betParticipant.deleteMany({});
  await prisma.betInvite.deleteMany({});
  await prisma.bet.deleteMany({});
  await prisma.matchEvidence.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.idempotencyKey.deleteMany({
    where: { scope: { startsWith: "pool-" } },
  });
  await prisma.user.deleteMany({
    where: { privyId: { startsWith: PRIVY_PREFIX } },
  });
}

beforeAll(async () => {
  await fullCleanup();
});

afterAll(async () => {
  await fullCleanup();
  await prisma.$disconnect();
});

// ── createPool ───────────────────────────────────────────────────────

describe("createPool", () => {
  it("happy path — Pool DRAFT met alle velden + IdempotencyKey row", async () => {
    const creator = await makeUser("c-happy");
    const key = newKey();
    const result = await createPool({
      creatorId: creator.id,
      title: `My pool ${SUFFIX}`,
      description: "  A test pool  ",
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: key,
    });

    expect(result.pool.status).toBe("DRAFT");
    expect(result.pool.title).toBe(`My pool ${SUFFIX}`);
    expect(result.pool.description).toBe("A test pool");
    expect(result.pool.createdById).toBe(creator.id);

    const idempRow = await prisma.idempotencyKey.findUnique({
      where: { key: `pool-create:${key}` },
    });
    expect(idempRow).not.toBeNull();
    expect(idempRow!.scope).toBe("pool-create");
    expect(idempRow!.userId).toBe(creator.id);
    expect((idempRow!.responseJson as { poolId: string }).poolId).toBe(result.pool.id);
  });

  it("title length out of range → POOL_INVALID_INPUT", async () => {
    const creator = await makeUser("c-title");
    const baseInput = {
      creatorId: creator.id,
      bettingClosesAt: deadlineHoursAhead(24),
    };
    await expect(
      createPool({
        ...baseInput,
        title: "",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_INVALID_INPUT" });
    await expect(
      createPool({
        ...baseInput,
        title: "x".repeat(201),
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_INVALID_INPUT" });
  });

  it("deadline out of range → POOL_DEADLINE_INVALID", async () => {
    const creator = await makeUser("c-dl");
    const baseInput = {
      creatorId: creator.id,
      title: `Pool ${SUFFIX}-dl`,
    };
    // 30 minutes ahead — below 1h min
    await expect(
      createPool({
        ...baseInput,
        bettingClosesAt: new Date(Date.now() + 30 * 60_000),
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_DEADLINE_INVALID" });
    // 91 days ahead — above 90d max
    await expect(
      createPool({
        ...baseInput,
        bettingClosesAt: deadlineHoursAhead(91 * 24),
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_DEADLINE_INVALID" });
    // 1 day in the past
    await expect(
      createPool({
        ...baseInput,
        bettingClosesAt: deadlineHoursAhead(-24),
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_DEADLINE_INVALID" });
  });

  it("idempotent replay — second call returns same pool", async () => {
    const creator = await makeUser("c-replay");
    const key = newKey();
    const baseInput = {
      creatorId: creator.id,
      title: `Replay pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: key,
    };

    const r1 = await createPool(baseInput);
    const r2 = await createPool(baseInput);

    expect(r2.pool.id).toBe(r1.pool.id);
    expect(
      await prisma.pool.count({ where: { createdById: creator.id } }),
    ).toBe(1);
    expect(
      await prisma.idempotencyKey.count({
        where: { key: `pool-create:${key}` },
      }),
    ).toBe(1);
  });
});

// ── publishPool ──────────────────────────────────────────────────────

describe("publishPool", () => {
  it("happy path DRAFT → OPEN", async () => {
    const creator = await makeUser("p-happy");
    const created = await createPool({
      creatorId: creator.id,
      title: `Publish pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    const result = await publishPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    expect(result.pool.status).toBe("OPEN");
  });

  it("non-creator → POOL_NOT_OWNED_BY_CALLER", async () => {
    const creator = await makeUser("p-c");
    const stranger = await makeUser("p-s");
    const created = await createPool({
      creatorId: creator.id,
      title: `Stranger pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    await expect(
      publishPool({
        poolId: created.pool.id,
        callerId: stranger.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_NOT_OWNED_BY_CALLER", statusCode: 403 });
  });

  it("already OPEN → POOL_INVALID_STATUS", async () => {
    const creator = await makeUser("p-double");
    const created = await createPool({
      creatorId: creator.id,
      title: `Double pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    await publishPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    await expect(
      publishPool({
        poolId: created.pool.id,
        callerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_INVALID_STATUS" });
  });

  it("deadline expired between create and publish → POOL_DEADLINE_INVALID", async () => {
    const creator = await makeUser("p-stale");
    const created = await createPool({
      creatorId: creator.id,
      title: `Stale pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    await prisma.pool.update({
      where: { id: created.pool.id },
      data: { bettingClosesAt: new Date(Date.now() - 60_000) },
    });
    await expect(
      publishPool({
        poolId: created.pool.id,
        callerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_DEADLINE_INVALID" });
  });
});

// ── closePool ────────────────────────────────────────────────────────

describe("closePool", () => {
  it("happy path OPEN → CLOSED", async () => {
    const creator = await makeUser("cl-happy");
    const created = await createPool({
      creatorId: creator.id,
      title: `Close pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    await publishPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    const result = await closePool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    expect(result.pool.status).toBe("CLOSED");
  });

  it("non-creator → POOL_NOT_OWNED_BY_CALLER", async () => {
    const creator = await makeUser("cl-c");
    const stranger = await makeUser("cl-s");
    const created = await createPool({
      creatorId: creator.id,
      title: `Close stranger pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    await publishPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    await expect(
      closePool({
        poolId: created.pool.id,
        callerId: stranger.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_NOT_OWNED_BY_CALLER" });
  });

  it("DRAFT pool (not OPEN) → POOL_INVALID_STATUS", async () => {
    const creator = await makeUser("cl-draft");
    const created = await createPool({
      creatorId: creator.id,
      title: `Draft pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    await expect(
      closePool({
        poolId: created.pool.id,
        callerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_INVALID_STATUS" });
  });
});

// ── cancelPool ───────────────────────────────────────────────────────

describe("cancelPool", () => {
  it("happy path DRAFT → CANCELLED", async () => {
    const creator = await makeUser("ca-happy");
    const created = await createPool({
      creatorId: creator.id,
      title: `Cancel pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    const result = await cancelPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    expect(result.pool.status).toBe("CANCELLED");
  });

  it("OPEN pool → POOL_HAS_BETS_CANNOT_CANCEL met state-specifieke message", async () => {
    const creator = await makeUser("ca-open");
    const created = await createPool({
      creatorId: creator.id,
      title: `Open cancel pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    await publishPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    try {
      await cancelPool({
        poolId: created.pool.id,
        callerId: creator.id,
        idempotencyKey: newKey(),
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PoolError);
      const poolErr = err as PoolError;
      expect(poolErr.code).toBe("POOL_HAS_BETS_CANNOT_CANCEL");
      expect(poolErr.message).toContain("published");
    }
  });

  it("DRAFT pool met attached bet (defensive) → POOL_HAS_BETS_CANNOT_CANCEL", async () => {
    const creator = await makeUser("ca-defensive");
    const otherCreator = await makeUser("ca-other-pool-creator");
    const opponent = await makeUser("ca-defensive-opp");
    // Create a separate "host" pool owned by otherCreator (so creator can attach a bet there).
    const hostPool = await prisma.pool.create({
      data: {
        createdById: otherCreator.id,
        title: `Host pool ${SUFFIX}`,
        bettingClosesAt: deadlineHoursAhead(24),
      },
    });
    // The pool we will try to cancel — owned by `creator`.
    const target = await createPool({
      creatorId: creator.id,
      title: `Defensive pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    // Manually insert a Bet with poolId=target.pool.id (bypassing service layer).
    // Trigger requires creator NOT to be the pool creator — so use otherCreator
    // as bet creator vs. opponent. But the trigger checks NEW.pool's creator vs.
    // bet creator/opponent. target.pool.createdById === creator.id, and our bet
    // uses otherCreator as bet creator, opponent as opponent — neither is creator.id.
    // So the trigger won't fire.
    await prisma.bet.create({
      data: {
        createdById: otherCreator.id,
        opponentUserId: opponent.id,
        creatorSide: "A",
        stakeUnits: 5_000_000n,
        expiresAt: deadlineHoursAhead(24),
        poolId: target.pool.id,
      },
    });

    await expect(
      cancelPool({
        poolId: target.pool.id,
        callerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "POOL_HAS_BETS_CANNOT_CANCEL" });
    // hostPool is just here to make test setup happy — assert it exists.
    expect(hostPool.id).toBeTruthy();
  });

  it("idempotent replay returns cancelled pool, no second mutation", async () => {
    const creator = await makeUser("ca-replay");
    const created = await createPool({
      creatorId: creator.id,
      title: `Replay cancel pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });
    const key = newKey();
    const r1 = await cancelPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: key,
    });
    const r2 = await cancelPool({
      poolId: created.pool.id,
      callerId: creator.id,
      idempotencyKey: key,
    });
    expect(r2.pool.id).toBe(r1.pool.id);
    expect(r2.pool.status).toBe("CANCELLED");
    expect(
      await prisma.idempotencyKey.count({
        where: { key: `pool-cancel:${key}` },
      }),
    ).toBe(1);
  });
});

// ── Race ─────────────────────────────────────────────────────────────

describe("Race edge case", () => {
  it("parallel publishPool × 2 — one wins, other POOL_INVALID_STATUS or POOL_VERSION_MISMATCH", async () => {
    const creator = await makeUser("r-creator");
    const created = await createPool({
      creatorId: creator.id,
      title: `Race pool ${SUFFIX}`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });

    const settled = await Promise.allSettled([
      publishPool({
        poolId: created.pool.id,
        callerId: creator.id,
        idempotencyKey: newKey(),
      }),
      publishPool({
        poolId: created.pool.id,
        callerId: creator.id,
        idempotencyKey: newKey(),
      }),
    ]);

    const succeeded = settled.filter((r) => r.status === "fulfilled");
    const failed = settled.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const failure = failed[0] as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(PoolError);
    const code = (failure.reason as PoolError).code;
    expect(["POOL_INVALID_STATUS", "POOL_VERSION_MISMATCH"]).toContain(code);

    const finalPool = await prisma.pool.findUniqueOrThrow({
      where: { id: created.pool.id },
    });
    expect(finalPool.status).toBe("OPEN");
  });
});
