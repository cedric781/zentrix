import { randomBytes } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { prisma } from "@/lib/prisma";
import {
  trackReputationEvent,
  getUserReputation,
  getReputationTier,
} from "@/lib/reputation/service";
import { recordTransaction } from "@/lib/ledger";
import { getExternalAccount, getUserAccount } from "@/lib/ledger/accounts";

const SUFFIX = randomBytes(4).toString("hex");
const PRIVY_PREFIX = `rep-${SUFFIX}-`;

async function fullCleanup(): Promise<void> {
  await prisma.dispute.deleteMany({});
  await prisma.betEvidence.deleteMany({});
  await prisma.betStateTransition.deleteMany({});
  await prisma.betParticipantConfirmation.deleteMany({});
  await prisma.betResultClaim.deleteMany({});
  await prisma.betParticipant.deleteMany({});
  await prisma.betInvite.deleteMany({});
  await prisma.bet.deleteMany({});
  await prisma.matchEvidence.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.ledgerEntry.deleteMany({});
  await prisma.ledgerTransaction.deleteMany({});
  await prisma.financialAccount.deleteMany({
    where: {
      OR: [
        { accountType: "USER" },
        { scopeKey: { startsWith: "bet:" } },
        { scopeKey: { startsWith: "dispute:" } },
      ],
    },
  });
  await prisma.idempotencyKey.deleteMany({
    where: {
      OR: [
        { scope: "dispute" },
        { scope: "dispute-evidence" },
        { scope: { startsWith: "bet-" } },
        { scope: { startsWith: "pool-" } },
        { key: { startsWith: "test-fund:" } },
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
}

async function makeUser(label: string, fundUnits: bigint = 0n) {
  const user = await prisma.user.create({
    data: {
      privyId: `${PRIVY_PREFIX}${label}`,
      email: `${PRIVY_PREFIX}${label}@example.com`,
    },
  });
  if (fundUnits > 0n) {
    await prisma.$transaction(async (tx) => {
      const ext = await getExternalAccount(tx);
      const userAcct = await getUserAccount(tx, user.id);
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

beforeAll(async () => {
  await fullCleanup();
});

afterAll(async () => {
  await fullCleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await fullCleanup();
});

// ──────────────────────────────────────────────────────────────────────
// CATEGORY A: per event type happy path (6 tests)
// ──────────────────────────────────────────────────────────────────────

describe("trackReputationEvent — per event type", () => {
  it("BET_SETTLED_CLEAN: +2 score, geen counter", async () => {
    const user = await makeUser("a1");
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "BET_SETTLED_CLEAN",
        refType: "bet",
        refId: `bet-${user.id}`,
      }),
    );
    expect(result.event.scoreDelta).toBe(2);
    expect(result.event.scoreAfter).toBe(502);
    expect(result.reputation.score).toBe(502);
    expect(result.reputation.disputesOpened).toBe(0);
    expect(result.reputation.disputesWon).toBe(0);
    expect(result.reputation.disputesLost).toBe(0);
    expect(result.tierChanged).toBe(false);
  });

  it("DISPUTE_OPENED: -5 score, disputesOpened++", async () => {
    const user = await makeUser("a2");
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "DISPUTE_OPENED",
        refType: "dispute",
        refId: `disp-${user.id}`,
      }),
    );
    expect(result.event.scoreDelta).toBe(-5);
    expect(result.reputation.score).toBe(495);
    expect(result.reputation.disputesOpened).toBe(1);
    expect(result.reputation.disputesWon).toBe(0);
    expect(result.reputation.disputesLost).toBe(0);
  });

  it("DISPUTE_WON: +15 score, disputesWon++", async () => {
    const user = await makeUser("a3");
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "DISPUTE_WON",
        refType: "dispute",
        refId: `disp-${user.id}`,
      }),
    );
    expect(result.event.scoreDelta).toBe(15);
    expect(result.reputation.score).toBe(515);
    expect(result.reputation.disputesWon).toBe(1);
  });

  it("DISPUTE_LOST: -25 score, disputesLost++", async () => {
    const user = await makeUser("a4");
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "DISPUTE_LOST",
        refType: "dispute",
        refId: `disp-${user.id}`,
      }),
    );
    expect(result.event.scoreDelta).toBe(-25);
    expect(result.reputation.score).toBe(475);
    expect(result.reputation.disputesLost).toBe(1);
  });

  it("DISPUTE_VOID: 0 delta, geen counter", async () => {
    const user = await makeUser("a5");
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "DISPUTE_VOID",
        refType: "dispute",
        refId: `disp-${user.id}`,
      }),
    );
    expect(result.event.scoreDelta).toBe(0);
    expect(result.reputation.score).toBe(500);
    expect(result.reputation.disputesOpened).toBe(0);
  });

  it("FORCE_CANCELLED: 0 delta, audit only", async () => {
    const user = await makeUser("a6");
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "FORCE_CANCELLED",
        refType: "bet",
        refId: `bet-${user.id}`,
      }),
    );
    expect(result.event.scoreDelta).toBe(0);
    expect(result.reputation.score).toBe(500);
    expect(result.event.eventType).toBe("FORCE_CANCELLED");
  });
});

// ──────────────────────────────────────────────────────────────────────
// CATEGORY B: idempotency + lazy create (2 tests)
// ──────────────────────────────────────────────────────────────────────

describe("trackReputationEvent — idempotency + lazy create", () => {
  it("idempotent replay: zelfde key 2x = 1 row", async () => {
    const user = await makeUser("b1");
    const input = {
      userId: user.id,
      eventType: "BET_SETTLED_CLEAN" as const,
      refType: "bet",
      refId: `bet-${user.id}`,
    };
    const r1 = await prisma.$transaction(async (tx) =>
      trackReputationEvent({ tx, ...input }),
    );
    const r2 = await prisma.$transaction(async (tx) =>
      trackReputationEvent({ tx, ...input }),
    );
    expect(r1.event.id).toBe(r2.event.id);
    const count = await prisma.reputationEvent.count({
      where: { userId: user.id },
    });
    expect(count).toBe(1);
    expect(r2.tierChanged).toBe(false);
  });

  it("lazy create UserReputation bij nieuwe user (score 500)", async () => {
    const user = await makeUser("b2");
    const before = await prisma.userReputation.findUnique({
      where: { userId: user.id },
    });
    expect(before).toBeNull();
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "BET_SETTLED_CLEAN",
        refType: "bet",
        refId: `bet-${user.id}`,
      }),
    );
    expect(result.reputation.score).toBe(502);
    expect(result.reputation.tier).toBe("NORMAL");
  });
});

// ──────────────────────────────────────────────────────────────────────
// CATEGORY C: edge cases (3 tests)
// ──────────────────────────────────────────────────────────────────────

describe("trackReputationEvent — clamp + tier transitions", () => {
  it("clamp boven 1000: seed 995 + DISPUTE_WON → score 1000", async () => {
    const user = await makeUser("c1");
    await prisma.userReputation.create({
      data: { userId: user.id, score: 995, tier: "NORMAL" },
    });
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "DISPUTE_WON",
        refType: "dispute",
        refId: `disp-${user.id}`,
      }),
    );
    expect(result.reputation.score).toBe(1000);
    expect(result.event.scoreAfter).toBe(1000);
  });

  it("clamp onder 0: seed 10 + DISPUTE_LOST → score 0", async () => {
    const user = await makeUser("c2");
    await prisma.userReputation.create({
      data: { userId: user.id, score: 10, tier: "FLAGGED" },
    });
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "DISPUTE_LOST",
        refType: "dispute",
        refId: `disp-${user.id}`,
      }),
    );
    expect(result.reputation.score).toBe(0);
    expect(result.event.scoreAfter).toBe(0);
    expect(result.reputation.tier).toBe("FLAGGED");
  });

  it("tier transition: 410 NORMAL → -25 = 385 RESTRICTED, tierChanged true", async () => {
    const user = await makeUser("c3");
    await prisma.userReputation.create({
      data: { userId: user.id, score: 410, tier: "NORMAL" },
    });
    const result = await prisma.$transaction(async (tx) =>
      trackReputationEvent({
        tx,
        userId: user.id,
        eventType: "DISPUTE_LOST",
        refType: "dispute",
        refId: `disp-${user.id}`,
      }),
    );
    expect(result.reputation.score).toBe(385);
    expect(result.reputation.tier).toBe("RESTRICTED");
    expect(result.tierChanged).toBe(true);
    expect(result.event.tierBefore).toBe("NORMAL");
    expect(result.event.tierAfter).toBe("RESTRICTED");
  });
});

// ──────────────────────────────────────────────────────────────────────
// CATEGORY D: getUserReputation read service (1 test)
// ──────────────────────────────────────────────────────────────────────

describe("getUserReputation read service", () => {
  it("lazy create bij nieuwe user (defaults score 500, tier NORMAL)", async () => {
    const user = await makeUser("d1");
    const rep = await getUserReputation(user.id);
    expect(rep.score).toBe(500);
    expect(rep.tier).toBe("NORMAL");
    expect(rep.disputesOpened).toBe(0);
    expect(rep.userId).toBe(user.id);
  });
});

// ──────────────────────────────────────────────────────────────────────
// CATEGORY E: getReputationTier pure helper (1 test)
// ──────────────────────────────────────────────────────────────────────

describe("getReputationTier pure helper", () => {
  it("classificeert correct over alle ranges", () => {
    expect(getReputationTier(0)).toBe("FLAGGED");
    expect(getReputationTier(199)).toBe("FLAGGED");
    expect(getReputationTier(200)).toBe("RESTRICTED");
    expect(getReputationTier(399)).toBe("RESTRICTED");
    expect(getReputationTier(400)).toBe("NORMAL");
    expect(getReputationTier(500)).toBe("NORMAL");
    expect(getReputationTier(1000)).toBe("NORMAL");
  });
});
