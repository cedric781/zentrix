import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import type { Match, Pool, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recordTransaction,
  getUserAccount,
  getExternalAccount,
  type TxClient,
} from "@/lib/ledger";
import { createPool, publishPool } from "@/lib/pools/service";
import {
  addMatchToPool,
  submitMatchResult,
  deleteMatch,
} from "@/lib/matches/service";
import { autoResolveMatchBets } from "@/lib/matches/auto-resolve";
import { createBet, acceptBet } from "@/lib/bets/service";

const SUFFIX = `match-lifecycle-${Date.now()}`;
const PRIVY_PREFIX = `ml-${SUFFIX}-`;
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
) {
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

// ── addMatchToPool ───────────────────────────────────────────────────

describe("addMatchToPool", () => {
  it("happy path — Match SCHEDULED + IdempotencyKey row", async () => {
    const creator = await makeUser("add-happy", 0n);
    const pool = await createPublishedPool(creator);
    const key = newKey();

    const result = await addMatchToPool({
      poolId: pool.id,
      callerId: creator.id,
      title: `M1 ${SUFFIX}`,
      description: "  desc  ",
      idempotencyKey: key,
    });

    expect(result.match.status).toBe("SCHEDULED");
    expect(result.match.poolId).toBe(pool.id);
    expect(result.match.title).toBe(`M1 ${SUFFIX}`);
    expect(result.match.description).toBe("desc");

    const idempRow = await prisma.idempotencyKey.findUnique({
      where: { key: `match-add:${key}` },
    });
    expect(idempRow).not.toBeNull();
    expect(idempRow!.scope).toBe("match-add");
    expect(idempRow!.userId).toBe(creator.id);
    expect((idempRow!.responseJson as { matchId: string }).matchId).toBe(
      result.match.id,
    );
  });

  it("DRAFT pool → MATCH_NOT_IN_OPEN_POOL", async () => {
    const creator = await makeUser("add-draft", 0n);
    const draftPool = await createPool({
      creatorId: creator.id,
      title: `Pool ${SUFFIX} draft`,
      bettingClosesAt: deadlineHoursAhead(24),
      idempotencyKey: newKey(),
    });

    await expect(
      addMatchToPool({
        poolId: draftPool.pool.id,
        callerId: creator.id,
        title: `M ${SUFFIX}`,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "MATCH_NOT_IN_OPEN_POOL" });
  });

  it("non-creator caller → MATCH_NOT_OWNED_BY_POOL_CREATOR", async () => {
    const creator = await makeUser("add-owner", 0n);
    const stranger = await makeUser("add-stranger", 0n);
    const pool = await createPublishedPool(creator);

    await expect(
      addMatchToPool({
        poolId: pool.id,
        callerId: stranger.id,
        title: `M ${SUFFIX}`,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "MATCH_NOT_OWNED_BY_POOL_CREATOR" });
  });

  it("idempotent replay returns same match", async () => {
    const creator = await makeUser("add-idem", 0n);
    const pool = await createPublishedPool(creator);
    const key = newKey();

    const r1 = await addMatchToPool({
      poolId: pool.id,
      callerId: creator.id,
      title: `M idem ${SUFFIX}`,
      idempotencyKey: key,
    });
    const r2 = await addMatchToPool({
      poolId: pool.id,
      callerId: creator.id,
      title: `M idem ${SUFFIX}`,
      idempotencyKey: key,
    });

    expect(r2.match.id).toBe(r1.match.id);
    const matchCount = await prisma.match.count({ where: { poolId: pool.id } });
    expect(matchCount).toBe(1);
    const idemCount = await prisma.idempotencyKey.count({
      where: { key: `match-add:${key}` },
    });
    expect(idemCount).toBe(1);
  });
});

// ── submitMatchResult ────────────────────────────────────────────────

describe("submitMatchResult", () => {
  it("happy path — RESULT_SUBMITTED + disputeWindowEndsAt ≈ +24h", async () => {
    const creator = await makeUser("sr-happy", 0n);
    const pool = await createPublishedPool(creator);
    const match = await addScheduledMatch(pool, creator);

    const before = Date.now();
    const result = await submitMatchResult({
      matchId: match.id,
      callerId: creator.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    expect(result.match.status).toBe("RESULT_SUBMITTED");
    expect(result.match.winnerSide).toBe("A");
    expect(result.match.submittedAt).not.toBeNull();
    expect(result.match.disputeWindowEndsAt).not.toBeNull();
    const dwe = result.match.disputeWindowEndsAt!.getTime();
    expect(dwe).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 5_000);
    expect(dwe).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 5_000);
    expect(result.evidenceCount).toBe(0);
  });

  it("multi-evidence + duplicate contentHash dedup → evidenceCount=3", async () => {
    const creator = await makeUser("sr-evi", 0n);
    const pool = await createPublishedPool(creator);
    const match = await addScheduledMatch(pool, creator);

    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const hashC = "c".repeat(64);

    const result = await submitMatchResult({
      matchId: match.id,
      callerId: creator.id,
      winnerSide: "B",
      evidence: [
        { type: "TEXT", contentHash: hashA, description: "note 1" },
        { type: "URL", fileUrl: "https://example.com/r1", contentHash: hashB },
        {
          type: "IMAGE",
          fileUrl: "https://example.com/img.png",
          mimeType: "image/png",
          contentHash: hashC,
        },
        { type: "TEXT", contentHash: hashA, description: "duplicate" },
      ],
      idempotencyKey: newKey(),
    });

    expect(result.evidenceCount).toBe(3);
    const persisted = await prisma.matchEvidence.count({
      where: { matchId: match.id },
    });
    expect(persisted).toBe(3);
  });

  it("non-pool-creator → MATCH_NOT_OWNED_BY_POOL_CREATOR", async () => {
    const creator = await makeUser("sr-owner", 0n);
    const stranger = await makeUser("sr-stranger", 0n);
    const pool = await createPublishedPool(creator);
    const match = await addScheduledMatch(pool, creator);

    await expect(
      submitMatchResult({
        matchId: match.id,
        callerId: stranger.id,
        winnerSide: "A",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "MATCH_NOT_OWNED_BY_POOL_CREATOR" });
  });

  it("second submit (different key) → MATCH_RESULT_ALREADY_SUBMITTED", async () => {
    const creator = await makeUser("sr-twice", 0n);
    const pool = await createPublishedPool(creator);
    const match = await addScheduledMatch(pool, creator);

    await submitMatchResult({
      matchId: match.id,
      callerId: creator.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });

    await expect(
      submitMatchResult({
        matchId: match.id,
        callerId: creator.id,
        winnerSide: "A",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "MATCH_RESULT_ALREADY_SUBMITTED" });
  });

  it("winnerSide invalid → MATCH_INVALID_INPUT", async () => {
    const creator = await makeUser("sr-side", 0n);
    const pool = await createPublishedPool(creator);
    const match = await addScheduledMatch(pool, creator);

    await expect(
      submitMatchResult({
        matchId: match.id,
        callerId: creator.id,
        // @ts-expect-error invalid value covered by runtime validation
        winnerSide: "C",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "MATCH_INVALID_INPUT" });
  });
});

// ── deleteMatch ──────────────────────────────────────────────────────

describe("deleteMatch", () => {
  it("happy path SCHEDULED + cascades MatchEvidence", async () => {
    const creator = await makeUser("dm-happy", 0n);
    const pool = await createPublishedPool(creator);
    const match = await addScheduledMatch(pool, creator);

    // Direct insert evidence (test-only, normally only after submitResult).
    await prisma.matchEvidence.create({
      data: {
        matchId: match.id,
        uploadedById: creator.id,
        type: "TEXT",
        contentHash: "d".repeat(64),
      },
    });
    expect(
      await prisma.matchEvidence.count({ where: { matchId: match.id } }),
    ).toBe(1);

    const r = await deleteMatch({
      matchId: match.id,
      callerId: creator.id,
      idempotencyKey: newKey(),
    });
    expect(r.deleted).toBe(true);

    expect(await prisma.match.findUnique({ where: { id: match.id } })).toBeNull();
    expect(
      await prisma.matchEvidence.count({ where: { matchId: match.id } }),
    ).toBe(0);
  });

  it("match with attached bet → MATCH_HAS_UNRESOLVED_BETS", async () => {
    const poolCreator = await makeUser("dm-pc", 0n);
    const bettorA = await makeUser("dm-a");
    const bettorB = await makeUser("dm-b");
    const pool = await createPublishedPool(poolCreator);
    const match = await addScheduledMatch(pool, poolCreator);
    await createPoolBet(match, bettorA, bettorB);

    await expect(
      deleteMatch({
        matchId: match.id,
        callerId: poolCreator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "MATCH_HAS_UNRESOLVED_BETS" });
  });

  it("match SETTLED → MATCH_INVALID_STATUS", async () => {
    const poolCreator = await makeUser("dm-set-pc", 0n);
    const pool = await createPublishedPool(poolCreator);
    const match = await addScheduledMatch(pool, poolCreator);
    await submitMatchResult({
      matchId: match.id,
      callerId: poolCreator.id,
      winnerSide: "A",
      idempotencyKey: newKey(),
    });
    await autoResolveMatchBets(match.id, { skipDisputeWindow: true });

    await expect(
      deleteMatch({
        matchId: match.id,
        callerId: poolCreator.id,
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({ code: "MATCH_INVALID_STATUS" });
  });
});
