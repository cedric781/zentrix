import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import crypto from "node:crypto";
import type { Bet, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recordTransaction,
  getUserAccount,
  getExternalAccount,
  type TxClient,
} from "@/lib/ledger";
import { createBet, acceptBet } from "@/lib/bets/service";
import {
  expireOpenBet,
  autoVoidProposedBet,
  deleteExpiredBetInvites,
  deleteExpiredIdempotencyKeys,
} from "@/lib/bets/expire";

const SUFFIX = `expire-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
const PRIVY_PREFIX = `ex-${SUFFIX}-`;

const testUserIds: string[] = [];

function newKey(): string {
  return crypto.randomUUID();
}

async function makeUser(
  label: string,
  fundUnits: bigint = 100_000_000n,
): Promise<User> {
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

async function createOpenBet(
  creator: User,
  stake: bigint = 25_000_000n,
): Promise<Bet> {
  const created = await createBet({
    creatorId: creator.id,
    creatorSide: "A",
    stakeUnits: stake,
    expiresInHours: 24,
    idempotencyKey: newKey(),
  });
  return created.bet;
}

async function createAcceptedBet(
  creator: User,
  opponent: User,
  stake: bigint = 25_000_000n,
): Promise<Bet> {
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
  return accepted.bet;
}

async function makeProposedBet(
  creator: User,
  opponent: User,
  confirmDeadline: Date,
  stake: bigint = 25_000_000n,
): Promise<Bet> {
  const active = await createAcceptedBet(creator, opponent, stake);
  const updated = await prisma.bet.update({
    where: { id: active.id },
    data: {
      status: "RESULT_PROPOSED",
      resultStatus: "PROPOSED",
      confirmDeadline,
      winnerId: creator.id,
      version: { increment: 1 },
    },
  });
  return updated;
}

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
        { scope: { startsWith: "bet-" } },
        { scope: { startsWith: "pool-" } },
        { scope: "test" },
        { key: { startsWith: "test-fund:" } },
        { key: { startsWith: `${PRIVY_PREFIX}` } },
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
  testUserIds.length = 0;
}

beforeAll(async () => {
  await fullCleanup();
});

beforeEach(async () => {
  await fullCleanup();
});

afterAll(async () => {
  await fullCleanup();
  await prisma.$disconnect();
});

// ── expireOpenBet ────────────────────────────────────────────────────

describe("expireOpenBet", () => {
  it("happy path — OPEN bet past expiresAt → EXPIRED, creator refunded, BET_EXPIRED reputation event, transition row", async () => {
    const creator = await makeUser("hp-creator");
    const stake = 25_000_000n;
    const bet = await createOpenBet(creator, stake);

    // Force expiresAt into past
    await prisma.bet.update({
      where: { id: bet.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const creatorBalBefore = await userBalance(creator.id);
    expect(await escrowBalance(bet.id)).toBe(stake);

    const result = await prisma.$transaction(async (tx) =>
      expireOpenBet(bet.id, tx),
    );

    expect(result.bet.status).toBe("EXPIRED");
    expect(typeof result.ledgerTxId).toBe("string");
    expect(typeof result.reputationEventId).toBe("string");

    expect(await userBalance(creator.id)).toBe(creatorBalBefore + stake);
    expect(await escrowBalance(bet.id)).toBe(0n);

    const ledgerTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: result.ledgerTxId },
    });
    expect(ledgerTx.idempotencyKey).toBe(`bet-expire:${bet.id}`);
    expect(ledgerTx.refType).toBe("bet");
    expect(ledgerTx.refId).toBe(bet.id);

    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId: result.ledgerTxId },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].amountUnits).toBe(stake);
    expect(entries[0].entryType).toBe("ESCROW_RELEASE");
    expect(entries[0].note).toBe(`bet-expire-refund:${bet.id}`);

    const repEvent = await prisma.reputationEvent.findUniqueOrThrow({
      where: { id: result.reputationEventId },
    });
    expect(repEvent.eventType).toBe("BET_EXPIRED");
    expect(repEvent.userId).toBe(creator.id);
    expect(repEvent.scoreDelta).toBe(-2);
    expect(repEvent.refType).toBe("bet");
    expect(repEvent.refId).toBe(bet.id);

    const transition = await prisma.betStateTransition.findFirstOrThrow({
      where: { betId: bet.id, toStatus: "EXPIRED" },
    });
    expect(transition.fromStatus).toBe("OPEN");
    expect(transition.actorType).toBe("SYSTEM_CRON");
    expect(transition.actorId).toBeNull();
    const meta = transition.metadata as { reason: string; ledgerTxId: string };
    expect(meta.reason).toBe("expiresAt < now");
    expect(meta.ledgerTxId).toBe(result.ledgerTxId);
  });

  it("BET_NOT_EXPIRED guard — expiresAt in future throws", async () => {
    const creator = await makeUser("ne-creator");
    const bet = await createOpenBet(creator);

    await expect(
      prisma.$transaction(async (tx) => expireOpenBet(bet.id, tx)),
    ).rejects.toThrow(/BET_NOT_EXPIRED|in future/);

    const refreshed = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(refreshed.status).toBe("OPEN");
  });

  it("BET_INVALID_STATUS guard — ACTIVE bet rejected", async () => {
    const creator = await makeUser("is-creator");
    const opponent = await makeUser("is-opponent");
    const bet = await createAcceptedBet(creator, opponent);

    // Bet is ACTIVE after acceptBet; force expiresAt past to bypass that guard
    await prisma.bet.update({
      where: { id: bet.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      prisma.$transaction(async (tx) => expireOpenBet(bet.id, tx)),
    ).rejects.toThrow(/BET_INVALID_STATUS|ACTIVE/);
  });

  it("idempotent replay — reset state, second call returns same ledger+reputation IDs", async () => {
    const creator = await makeUser("idem-creator");
    const bet = await createOpenBet(creator);
    await prisma.bet.update({
      where: { id: bet.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const before = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    const originalVersion = before.version;

    const result1 = await prisma.$transaction(async (tx) =>
      expireOpenBet(bet.id, tx),
    );

    // Reset status + version to simulate "what if recalled"
    await prisma.bet.update({
      where: { id: bet.id },
      data: { status: "OPEN", version: originalVersion },
    });

    const result2 = await prisma.$transaction(async (tx) =>
      expireOpenBet(bet.id, tx),
    );

    expect(result2.ledgerTxId).toBe(result1.ledgerTxId);
    expect(result2.reputationEventId).toBe(result1.reputationEventId);

    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId: result1.ledgerTxId },
    });
    expect(entries).toHaveLength(1);

    const eventCount = await prisma.reputationEvent.count({
      where: {
        userId: creator.id,
        eventType: "BET_EXPIRED",
        refId: bet.id,
      },
    });
    expect(eventCount).toBe(1);
  });
});

// ── autoVoidProposedBet ──────────────────────────────────────────────

describe("autoVoidProposedBet", () => {
  it("happy path — RESULT_PROPOSED past confirmDeadline → VOID, both refunded, no reputation event", async () => {
    const creator = await makeUser("v-creator");
    const opponent = await makeUser("v-opponent");
    const stake = 25_000_000n;
    const bet = await makeProposedBet(
      creator,
      opponent,
      new Date(Date.now() - 1000),
      stake,
    );

    const creatorBalBefore = await userBalance(creator.id);
    const opponentBalBefore = await userBalance(opponent.id);
    expect(await escrowBalance(bet.id)).toBe(stake * 2n);

    const result = await prisma.$transaction(async (tx) =>
      autoVoidProposedBet(bet.id, tx),
    );

    expect(result.bet.status).toBe("VOID");
    expect(result.bet.voidedAt).not.toBeNull();
    expect(typeof result.ledgerTxId).toBe("string");

    expect(await userBalance(creator.id)).toBe(creatorBalBefore + stake);
    expect(await userBalance(opponent.id)).toBe(opponentBalBefore + stake);
    expect(await escrowBalance(bet.id)).toBe(0n);

    const ledgerTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: result.ledgerTxId },
    });
    expect(ledgerTx.idempotencyKey).toBe(`bet-void:${bet.id}`);

    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId: result.ledgerTxId },
      orderBy: { amountUnits: "asc" },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].amountUnits).toBe(stake);
    expect(entries[1].amountUnits).toBe(stake);
    expect(entries[0].entryType).toBe("ESCROW_RELEASE");
    expect(entries[1].entryType).toBe("ESCROW_RELEASE");

    const repEventCount = await prisma.reputationEvent.count({
      where: { refType: "bet", refId: bet.id },
    });
    expect(repEventCount).toBe(0);

    const transition = await prisma.betStateTransition.findFirstOrThrow({
      where: { betId: bet.id, toStatus: "VOID" },
    });
    expect(transition.fromStatus).toBe("RESULT_PROPOSED");
    expect(transition.actorType).toBe("SYSTEM_CRON");
    expect(transition.actorId).toBeNull();
  });

  it("BET_NOT_VOIDED guard — confirmDeadline in future throws", async () => {
    const creator = await makeUser("nv-creator");
    const opponent = await makeUser("nv-opponent");
    const bet = await makeProposedBet(
      creator,
      opponent,
      new Date(Date.now() + 10_000),
    );

    await expect(
      prisma.$transaction(async (tx) => autoVoidProposedBet(bet.id, tx)),
    ).rejects.toThrow(/BET_NOT_VOIDED|in future/);

    const refreshed = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(refreshed.status).toBe("RESULT_PROPOSED");
  });

  it("BET_INVALID_STATUS guard — OPEN bet rejected", async () => {
    const creator = await makeUser("vis-creator");
    const bet = await createOpenBet(creator);

    await expect(
      prisma.$transaction(async (tx) => autoVoidProposedBet(bet.id, tx)),
    ).rejects.toThrow(/BET_INVALID_STATUS|OPEN/);
  });

  it("BET_NO_OPPONENT guard — defensive check throws when opponent missing", async () => {
    const creator = await makeUser("no-creator");
    const bet = await createOpenBet(creator);
    // Force into RESULT_PROPOSED without acceptBet (artificial — defensive guard)
    await prisma.bet.update({
      where: { id: bet.id },
      data: {
        status: "RESULT_PROPOSED",
        confirmDeadline: new Date(Date.now() - 1000),
      },
    });

    await expect(
      prisma.$transaction(async (tx) => autoVoidProposedBet(bet.id, tx)),
    ).rejects.toThrow(/BET_NO_OPPONENT|no opponent/);
  });
});

// ── deleteExpiredBetInvites ──────────────────────────────────────────

describe("deleteExpiredBetInvites", () => {
  it("removes expired+unused invites, preserves future or used", async () => {
    const creator = await makeUser("inv-creator");
    const opponent = await makeUser("inv-opponent");

    const expiredOpen = await createOpenBet(creator);
    const futureOpen = await createOpenBet(creator);
    const usedBet = await createAcceptedBet(creator, opponent);

    await prisma.betInvite.update({
      where: { betId: expiredOpen.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.betInvite.update({
      where: { betId: usedBet.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const deletedCount = await prisma.$transaction(async (tx) =>
      deleteExpiredBetInvites(tx),
    );

    expect(deletedCount).toBeGreaterThanOrEqual(1);

    expect(
      await prisma.betInvite.findUnique({ where: { betId: expiredOpen.id } }),
    ).toBeNull();
    expect(
      await prisma.betInvite.findUnique({ where: { betId: futureOpen.id } }),
    ).not.toBeNull();
    expect(
      await prisma.betInvite.findUnique({ where: { betId: usedBet.id } }),
    ).not.toBeNull();
  });

  it("returns 0 when no expired+unused invites exist", async () => {
    const creator = await makeUser("inv-zero");
    await createOpenBet(creator);

    const deletedCount = await prisma.$transaction(async (tx) =>
      deleteExpiredBetInvites(tx),
    );

    expect(deletedCount).toBe(0);
  });
});

// ── deleteExpiredIdempotencyKeys ─────────────────────────────────────

describe("deleteExpiredIdempotencyKeys", () => {
  it("removes rows with expiresAt < now, preserves null-expiry and future-expiry", async () => {
    await prisma.idempotencyKey.createMany({
      data: [
        {
          key: `${PRIVY_PREFIX}past-key`,
          scope: "test",
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          key: `${PRIVY_PREFIX}future-key`,
          scope: "test",
          expiresAt: new Date(Date.now() + 10_000),
        },
        {
          key: `${PRIVY_PREFIX}null-key`,
          scope: "test",
          expiresAt: null,
        },
      ],
    });

    const deletedCount = await prisma.$transaction(async (tx) =>
      deleteExpiredIdempotencyKeys(tx),
    );

    expect(deletedCount).toBeGreaterThanOrEqual(1);

    expect(
      await prisma.idempotencyKey.findUnique({
        where: { key: `${PRIVY_PREFIX}past-key` },
      }),
    ).toBeNull();
    expect(
      await prisma.idempotencyKey.findUnique({
        where: { key: `${PRIVY_PREFIX}future-key` },
      }),
    ).not.toBeNull();
    expect(
      await prisma.idempotencyKey.findUnique({
        where: { key: `${PRIVY_PREFIX}null-key` },
      }),
    ).not.toBeNull();
  });

  it("returns 0 when no expired keys exist", async () => {
    await prisma.idempotencyKey.create({
      data: {
        key: `${PRIVY_PREFIX}fresh-key`,
        scope: "test",
        expiresAt: new Date(Date.now() + 10_000),
      },
    });

    const deletedCount = await prisma.$transaction(async (tx) =>
      deleteExpiredIdempotencyKeys(tx),
    );

    expect(deletedCount).toBe(0);
  });
});
