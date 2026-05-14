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
  openDispute,
  submitDisputeEvidence,
} from "@/lib/disputes/service";

const SUFFIX = `disp-lifecycle-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 7)}`;
const PRIVY_PREFIX = `dl-${SUFFIX}-`;

const testUserIds: string[] = [];

function newKey(): string {
  return crypto.randomUUID();
}

function newHash(): string {
  return crypto.randomBytes(32).toString("hex");
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

async function disputeEscrowBalance(disputeId: string): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: `dispute:${disputeId}` },
  });
  return acct?.balanceUnits ?? 0n;
}

async function createAcceptedBet(
  creator: User,
  opponent: User,
  stake: bigint,
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

// ── openDispute ──────────────────────────────────────────────────────

describe("openDispute", () => {
  it("happy path — opener=opponent locks deposit, dispute OPEN, bet DISPUTED, transition row, idempotency completed", async () => {
    const creator = await makeUser("hp-creator");
    const opponent = await makeUser("hp-opponent");
    const stake = 5_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);

    const opponentBalBefore = await userBalance(opponent.id);
    const key = newKey();

    const result = await openDispute({
      betId: bet.id,
      openerId: opponent.id,
      reason: "Result claim incorrect — opponent disputes",
      idempotencyKey: key,
    });

    expect(result.dispute.status).toBe("OPEN");
    expect(result.dispute.openedById).toBe(opponent.id);
    expect(result.dispute.betId).toBe(bet.id);
    expect(result.depositUnits).toBe(500_000n);
    expect(typeof result.ledgerTxId).toBe("string");

    const refreshedBet = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
    });
    expect(refreshedBet.status).toBe("DISPUTED");
    expect(refreshedBet.resultStatus).toBe("DISPUTED");
    expect(refreshedBet.version).toBe(bet.version + 1);

    expect(await disputeEscrowBalance(result.dispute.id)).toBe(500_000n);
    expect(await userBalance(opponent.id)).toBe(opponentBalBefore - 500_000n);

    const transition = await prisma.betStateTransition.findFirst({
      where: {
        betId: bet.id,
        fromStatus: "ACTIVE",
        toStatus: "DISPUTED",
      },
    });
    expect(transition).not.toBeNull();
    expect(transition!.actorId).toBe(opponent.id);
    expect(transition!.actorType).toBe("USER");
    const meta = transition!.metadata as {
      disputeId: string;
      depositLedgerTxId: string;
      depositUnits: string;
    };
    expect(meta.disputeId).toBe(result.dispute.id);
    expect(meta.depositLedgerTxId).toBe(result.ledgerTxId);
    expect(meta.depositUnits).toBe("500000");

    const idemp = await prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId: opponent.id, key } },
    });
    expect(idemp).not.toBeNull();
    expect(idemp!.scope).toBe("dispute");
    expect(idemp!.route).toBe("dispute-open");
    expect(idemp!.statusCode).toBe(201);
    expect(idemp!.completedAt).not.toBeNull();
    const responseJson = idemp!.responseJson as {
      disputeId: string;
      depositUnits: string;
      ledgerTxId: string;
    };
    expect(responseJson.disputeId).toBe(result.dispute.id);
    expect(responseJson.depositUnits).toBe("500000");
    expect(responseJson.ledgerTxId).toBe(result.ledgerTxId);

    const ledgerTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: result.ledgerTxId },
    });
    expect(ledgerTx.refType).toBe("dispute");
    expect(ledgerTx.refId).toBe(result.dispute.id);
  });

  it("insufficient balance — opener has 0 after accept, throws DISPUTE_INSUFFICIENT_BALANCE, no state change", async () => {
    const creator = await makeUser("ib-creator");
    // Fund opponent with exactly stake — after acceptBet balance drops to 0,
    // so the dispute deposit of 500_000n cannot be locked.
    const stake = 5_000_000n;
    const opponent = await makeUser("ib-opponent", stake);
    const bet = await createAcceptedBet(creator, opponent, stake);
    expect(await userBalance(opponent.id)).toBe(0n);

    const disputeCountBefore = await prisma.dispute.count({
      where: { betId: bet.id },
    });
    const transitionCountBefore = await prisma.betStateTransition.count({
      where: { betId: bet.id, toStatus: "DISPUTED" },
    });

    await expect(
      openDispute({
        betId: bet.id,
        openerId: opponent.id,
        reason: "no balance for deposit",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      name: "DisputeError",
      code: "DISPUTE_INSUFFICIENT_BALANCE",
      statusCode: 402,
    });

    const after = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.version).toBe(bet.version);
    expect(await userBalance(opponent.id)).toBe(0n);
    expect(
      await prisma.dispute.count({ where: { betId: bet.id } }),
    ).toBe(disputeCountBefore);
    expect(
      await prisma.betStateTransition.count({
        where: { betId: bet.id, toStatus: "DISPUTED" },
      }),
    ).toBe(transitionCountBefore);
  });

  it("non-participant — random user → DISPUTE_NOT_PARTICIPANT, no state change", async () => {
    const creator = await makeUser("np-creator");
    const opponent = await makeUser("np-opponent");
    const stranger = await makeUser("np-stranger");
    const stake = 5_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);
    const strangerBalBefore = await userBalance(stranger.id);

    await expect(
      openDispute({
        betId: bet.id,
        openerId: stranger.id,
        reason: "I want in on this dispute",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      name: "DisputeError",
      code: "DISPUTE_NOT_PARTICIPANT",
      statusCode: 403,
    });

    const after = await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.version).toBe(bet.version);
    expect(
      await prisma.dispute.count({ where: { betId: bet.id } }),
    ).toBe(0);
    expect(await userBalance(stranger.id)).toBe(strangerBalBefore);
  });

  it("already-open dispute — second call by other participant → DISPUTE_ALREADY_OPEN, state unchanged after second", async () => {
    const creator = await makeUser("ao-creator");
    const opponent = await makeUser("ao-opponent");
    const stake = 5_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);

    const first = await openDispute({
      betId: bet.id,
      openerId: opponent.id,
      reason: "opponent opens first",
      idempotencyKey: newKey(),
    });

    const betAfterFirst = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
    });
    const opponentBalAfterFirst = await userBalance(opponent.id);
    const creatorBalAfterFirst = await userBalance(creator.id);
    const escrowAfterFirst = await disputeEscrowBalance(first.dispute.id);
    const disputeCountAfterFirst = await prisma.dispute.count({
      where: { betId: bet.id },
    });
    const transitionCountAfterFirst = await prisma.betStateTransition.count({
      where: { betId: bet.id, toStatus: "DISPUTED" },
    });

    await expect(
      openDispute({
        betId: bet.id,
        openerId: creator.id,
        reason: "creator tries to open second dispute",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      name: "DisputeError",
      code: "DISPUTE_ALREADY_OPEN",
      statusCode: 409,
    });

    const betAfterSecond = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
    });
    expect(betAfterSecond.status).toBe(betAfterFirst.status);
    expect(betAfterSecond.version).toBe(betAfterFirst.version);
    expect(await userBalance(opponent.id)).toBe(opponentBalAfterFirst);
    expect(await userBalance(creator.id)).toBe(creatorBalAfterFirst);
    expect(await disputeEscrowBalance(first.dispute.id)).toBe(escrowAfterFirst);
    expect(
      await prisma.dispute.count({ where: { betId: bet.id } }),
    ).toBe(disputeCountAfterFirst);
    expect(
      await prisma.betStateTransition.count({
        where: { betId: bet.id, toStatus: "DISPUTED" },
      }),
    ).toBe(transitionCountAfterFirst);
  });
});

// ── submitDisputeEvidence ────────────────────────────────────────────

describe("submitDisputeEvidence", () => {
  it("happy path 3 items — dispute OPEN → EVIDENCE_PHASE, 3 BetEvidence rows with [dispute:id] description prefix", async () => {
    const creator = await makeUser("ev-hp-creator");
    const opponent = await makeUser("ev-hp-opponent");
    const stake = 5_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);
    const opened = await openDispute({
      betId: bet.id,
      openerId: opponent.id,
      reason: "opening for evidence happy path",
      idempotencyKey: newKey(),
    });
    const disputeId = opened.dispute.id;

    const items = [
      {
        type: "TEXT" as const,
        contentHash: newHash(),
        description: "screenshot of result screen",
      },
      {
        type: "URL" as const,
        fileUrl: "https://example.com/replay-a",
        contentHash: newHash(),
      },
      {
        type: "IMAGE" as const,
        fileUrl: "https://example.com/proof.png",
        contentHash: newHash(),
      },
    ];

    const key = newKey();
    const result = await submitDisputeEvidence({
      disputeId,
      uploaderId: opponent.id,
      items,
      idempotencyKey: key,
    });

    expect(result.evidenceAdded).toBe(3);
    expect(result.evidenceTotal).toBe(3);
    expect(result.dispute.status).toBe("EVIDENCE_PHASE");

    const rows = await prisma.betEvidence.findMany({
      where: { betId: bet.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.uploadedById).toBe(opponent.id);
      expect(row.description ?? "").toContain(`[dispute:${disputeId}]`);
    }
    const hashes = new Set(rows.map((r) => r.contentHash));
    for (const item of items) {
      expect(hashes.has(item.contentHash)).toBe(true);
    }

    const idemp = await prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId: opponent.id, key } },
    });
    expect(idemp).not.toBeNull();
    expect(idemp!.scope).toBe("dispute-evidence");
    expect(idemp!.route).toBe("dispute-evidence");
    expect(idemp!.statusCode).toBe(200);
    expect(idemp!.completedAt).not.toBeNull();
  });

  it("both parties upload — opener then defender, both uploaderIds in BetEvidence, dispute = EVIDENCE_PHASE", async () => {
    const creator = await makeUser("ev-both-creator");
    const opponent = await makeUser("ev-both-opponent");
    const stake = 5_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);
    const opened = await openDispute({
      betId: bet.id,
      openerId: opponent.id,
      reason: "both parties will upload evidence",
      idempotencyKey: newKey(),
    });
    const disputeId = opened.dispute.id;

    const openerResult = await submitDisputeEvidence({
      disputeId,
      uploaderId: opponent.id,
      items: [
        {
          type: "TEXT" as const,
          contentHash: newHash(),
          description: "opener's evidence",
        },
      ],
      idempotencyKey: newKey(),
    });
    expect(openerResult.evidenceAdded).toBe(1);
    expect(openerResult.evidenceTotal).toBe(1);
    expect(openerResult.dispute.status).toBe("EVIDENCE_PHASE");

    const defenderResult = await submitDisputeEvidence({
      disputeId,
      uploaderId: creator.id,
      items: [
        {
          type: "URL" as const,
          fileUrl: "https://example.com/defender-1",
          contentHash: newHash(),
          description: "defender first",
        },
        {
          type: "URL" as const,
          fileUrl: "https://example.com/defender-2",
          contentHash: newHash(),
          description: "defender second",
        },
      ],
      idempotencyKey: newKey(),
    });
    expect(defenderResult.evidenceAdded).toBe(2);
    expect(defenderResult.evidenceTotal).toBe(3);
    expect(defenderResult.dispute.status).toBe("EVIDENCE_PHASE");

    const rows = await prisma.betEvidence.findMany({
      where: { betId: bet.id },
    });
    expect(rows).toHaveLength(3);
    const uploaderIds = new Set(rows.map((r) => r.uploadedById));
    expect(uploaderIds.has(opponent.id)).toBe(true);
    expect(uploaderIds.has(creator.id)).toBe(true);
    for (const row of rows) {
      expect(row.description ?? "").toContain(`[dispute:${disputeId}]`);
    }
  });

  it("11th item triggers DISPUTE_EVIDENCE_LIMIT — opener has 10 prior rows, +1 fails, no new row", async () => {
    const creator = await makeUser("ev-lim-creator");
    const opponent = await makeUser("ev-lim-opponent");
    const stake = 5_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);
    const opened = await openDispute({
      betId: bet.id,
      openerId: opponent.id,
      reason: "limit test",
      idempotencyKey: newKey(),
    });
    const disputeId = opened.dispute.id;

    const seedHashes = Array.from({ length: 10 }, () => newHash());
    await prisma.betEvidence.createMany({
      data: seedHashes.map((hash, i) => ({
        betId: bet.id,
        uploadedById: opponent.id,
        type: "TEXT" as const,
        contentHash: hash,
        description: `[dispute:${disputeId}] pre-seed ${i}`,
      })),
    });
    const seedCount = await prisma.betEvidence.count({
      where: { betId: bet.id, uploadedById: opponent.id },
    });
    expect(seedCount).toBe(10);

    await expect(
      submitDisputeEvidence({
        disputeId,
        uploaderId: opponent.id,
        items: [
          {
            type: "TEXT" as const,
            contentHash: newHash(),
            description: "the offending eleventh item",
          },
        ],
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      name: "DisputeError",
      code: "DISPUTE_EVIDENCE_LIMIT",
      statusCode: 400,
    });

    const afterCount = await prisma.betEvidence.count({
      where: { betId: bet.id, uploadedById: opponent.id },
    });
    expect(afterCount).toBe(10);
    const surviving = await prisma.betEvidence.findMany({
      where: { betId: bet.id, uploadedById: opponent.id },
      select: { contentHash: true },
    });
    const survivingHashes = new Set(surviving.map((r) => r.contentHash));
    for (const hash of seedHashes) {
      expect(survivingHashes.has(hash)).toBe(true);
    }
  });

  it("dedup within items[] AND against existing DB rows — 5 items, 2 dup-within + 1 dup-DB, evidenceAdded=2", async () => {
    const creator = await makeUser("ev-dd-creator");
    const opponent = await makeUser("ev-dd-opponent");
    const stake = 5_000_000n;
    const bet = await createAcceptedBet(creator, opponent, stake);
    const opened = await openDispute({
      betId: bet.id,
      openerId: opponent.id,
      reason: "dedup test",
      idempotencyKey: newKey(),
    });
    const disputeId = opened.dispute.id;

    const hashA = newHash();
    const hashB = newHash();
    const hashExisting = newHash();

    // Pre-seed: 1 row with hashExisting (uploaded by creator, not by opener).
    await prisma.betEvidence.create({
      data: {
        betId: bet.id,
        uploadedById: creator.id,
        type: "TEXT",
        contentHash: hashExisting,
        description: `[dispute:${disputeId}] pre-existing in DB`,
      },
    });
    expect(
      await prisma.betEvidence.count({ where: { betId: bet.id } }),
    ).toBe(1);

    // Opener submits 5 items:
    //   - hashA appears twice (1 dup-within)
    //   - hashB appears twice (1 dup-within)
    //   - hashExisting collides with the pre-seeded DB row (1 dup-DB)
    // After Set dedup → [hashA, hashB, hashExisting] (3 distinct).
    // After DB dedup → [hashA, hashB] (2 new).
    const items = [
      { type: "TEXT" as const, contentHash: hashA, description: "first A" },
      { type: "TEXT" as const, contentHash: hashB, description: "first B" },
      {
        type: "TEXT" as const,
        contentHash: hashExisting,
        description: "dup against DB",
      },
      { type: "TEXT" as const, contentHash: hashA, description: "dup A within" },
      { type: "TEXT" as const, contentHash: hashB, description: "dup B within" },
    ];

    const result = await submitDisputeEvidence({
      disputeId,
      uploaderId: opponent.id,
      items,
      idempotencyKey: newKey(),
    });
    expect(result.evidenceAdded).toBe(2);
    expect(result.evidenceTotal).toBe(3);
    expect(result.dispute.status).toBe("EVIDENCE_PHASE");

    const rows = await prisma.betEvidence.findMany({
      where: { betId: bet.id },
    });
    expect(rows).toHaveLength(3);
    const hashes = new Set(rows.map((r) => r.contentHash));
    expect(hashes.has(hashA)).toBe(true);
    expect(hashes.has(hashB)).toBe(true);
    expect(hashes.has(hashExisting)).toBe(true);

    // The pre-seeded row keeps creator as uploader; the two new rows are opener's.
    const opponentRows = rows.filter((r) => r.uploadedById === opponent.id);
    const creatorRows = rows.filter((r) => r.uploadedById === creator.id);
    expect(opponentRows).toHaveLength(2);
    expect(creatorRows).toHaveLength(1);
  });
});
