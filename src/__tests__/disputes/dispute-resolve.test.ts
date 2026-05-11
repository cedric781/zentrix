import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import crypto from "node:crypto";
import type { Bet, Dispute, User } from "@prisma/client";
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
  resolveDispute,
  forceCancelBet,
} from "@/lib/disputes/service";
import { _resetEnvCache } from "@/lib/env";
import { applyBps, FEES } from "@/lib/fees";

const SUFFIX = `disp-resolve-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 7)}`;
const PRIVY_PREFIX = `dr-${SUFFIX}-`;

const STAKE: bigint = 10_000_000n;
const POT: bigint = STAKE * 2n;
const DEPOSIT: bigint = applyBps(STAKE, FEES.DISPUTE_DEPOSIT_BPS); // 1_000_000n
const FEE: bigint = applyBps(POT, FEES.DISPUTE_RESOLUTION_BPS); // 3_000_000n
const PAYOUT: bigint = POT - FEE; // 17_000_000n

const testUserIds: string[] = [];

const ORIGINAL_ADMIN_USER_IDS = process.env.ADMIN_USER_IDS;
let pendingAdminRestore: (() => void) | null = null;

function newKey(): string {
  return crypto.randomUUID();
}

function resetAdminEnv(): void {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS;
  }
  _resetEnvCache();
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

async function betEscrowBalance(betId: string): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: `bet:${betId}` },
  });
  return acct?.balanceUnits ?? 0n;
}

async function disputeEscrowBalance(disputeId: string): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: `dispute:${disputeId}` },
  });
  return acct?.balanceUnits ?? 0n;
}

async function treasuryBalance(): Promise<bigint> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: "treasury" },
  });
  return acct?.balanceUnits ?? 0n;
}

async function createAcceptedBet(
  creator: User,
  opponent: User,
  stake: bigint = STAKE,
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

async function createDisputeReady(
  creator: User,
  opponent: User,
  opener: User,
  stake: bigint = STAKE,
): Promise<{ bet: Bet; dispute: Dispute; depositUnits: bigint }> {
  const bet = await createAcceptedBet(creator, opponent, stake);
  const result = await openDispute({
    betId: bet.id,
    openerId: opener.id,
    reason: `dispute opened by ${opener.privyId} on ${bet.id}`,
    idempotencyKey: newKey(),
  });
  return {
    bet: await prisma.bet.findUniqueOrThrow({ where: { id: bet.id } }),
    dispute: result.dispute,
    depositUnits: result.depositUnits,
  };
}

async function setupAdmin(): Promise<{ admin: User; restore: () => void }> {
  const admin = await prisma.user.create({
    data: {
      privyId: `${PRIVY_PREFIX}admin-${crypto.randomBytes(3).toString("hex")}`,
      email: `${PRIVY_PREFIX}admin-${crypto
        .randomBytes(3)
        .toString("hex")}@example.com`,
    },
  });
  testUserIds.push(admin.id);
  const previous = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = admin.id;
  _resetEnvCache();
  return {
    admin,
    restore: () => {
      if (previous === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = previous;
      _resetEnvCache();
    },
  };
}

async function getTreasuryAccountId(): Promise<string> {
  const acct = await prisma.financialAccount.findUniqueOrThrow({
    where: { scopeKey: "treasury" },
  });
  return acct.id;
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
        { scope: "dispute-resolve" },
        { scope: "force-cancel-bet" },
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
  await prisma.financialAccount.updateMany({
    where: { scopeKey: { in: ["treasury", "external"] } },
    data: { balanceUnits: 0n },
  });
  testUserIds.length = 0;
}

beforeAll(async () => {
  await fullCleanup();
  resetAdminEnv();
});

beforeEach(async () => {
  await fullCleanup();
  resetAdminEnv();
});

afterEach(() => {
  if (pendingAdminRestore) {
    pendingAdminRestore();
    pendingAdminRestore = null;
  }
  resetAdminEnv();
});

afterAll(async () => {
  resetAdminEnv();
  await fullCleanup();
  await prisma.$disconnect();
});

// ── resolveDispute outcomes ──────────────────────────────────────────

describe("resolveDispute outcomes", () => {
  it("CREATOR_WINS, opener=creator (winner) — fee 15% to treasury, deposit refund to opener, ledger entries = 2", async () => {
    const creator = await makeUser("cw-win-creator");
    const opponent = await makeUser("cw-win-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute, depositUnits } = await createDisputeReady(
      creator,
      opponent,
      creator,
    );
    expect(depositUnits).toBe(DEPOSIT);

    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const treasuryBefore = await treasuryBalance();
    expect(await betEscrowBalance(bet.id)).toBe(POT);
    expect(await disputeEscrowBalance(dispute.id)).toBe(DEPOSIT);

    const result = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "CREATOR_WINS",
      adminNotes: "creator was right",
      idempotencyKey: newKey(),
    });

    expect(result.dispute.status).toBe("RESOLVED");
    expect(result.dispute.outcome).toBe("CREATOR_WINS");
    expect(result.dispute.resolvedById).toBe(admin.id);
    expect(result.bet.status).toBe("SETTLED");
    expect(result.bet.winnerId).toBe(creator.id);
    expect(result.ledgerTxIds.length).toBeGreaterThanOrEqual(2);

    // Fee-replacement invariant: settle tx has exactly 2 entries (payout + fee),
    // and the treasury credit equals applyBps(pot, 1500) — NOT 17%, NOT a second
    // 2% baseline fee line.
    const settleTx = await prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: `dispute-resolve:${dispute.id}` },
    });
    expect(settleTx).not.toBeNull();
    const settleEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: settleTx!.id },
    });
    expect(settleEntries).toHaveLength(2);
    const treasuryAcctId = await getTreasuryAccountId();
    const treasuryEntries = settleEntries.filter(
      (e) => e.creditAccountId === treasuryAcctId,
    );
    expect(treasuryEntries).toHaveLength(1);
    expect(treasuryEntries[0].amountUnits).toBe(FEE);

    // Treasury delta from settlement only (winner-opener → no deposit forfeit).
    expect((await treasuryBalance()) - treasuryBefore).toBe(FEE);

    // Creator: +PAYOUT (from settle) + DEPOSIT (refund).
    expect((await userBalance(creator.id)) - creatorBefore).toBe(
      PAYOUT + DEPOSIT,
    );
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(0n);

    expect(await betEscrowBalance(bet.id)).toBe(0n);
    expect(await disputeEscrowBalance(dispute.id)).toBe(0n);
  });

  it("CREATOR_WINS, opener=opponent (loser) — fee 15% + deposit forfeit both to treasury, ledger entries = 2", async () => {
    const creator = await makeUser("cw-lose-creator");
    const opponent = await makeUser("cw-lose-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute } = await createDisputeReady(creator, opponent, opponent);

    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const treasuryBefore = await treasuryBalance();

    const result = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "CREATOR_WINS",
      adminNotes: "opener was wrong",
      idempotencyKey: newKey(),
    });

    expect(result.dispute.outcome).toBe("CREATOR_WINS");
    expect(result.bet.status).toBe("SETTLED");
    expect(result.bet.winnerId).toBe(creator.id);

    const settleTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `dispute-resolve:${dispute.id}` },
    });
    const settleEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: settleTx.id },
    });
    expect(settleEntries).toHaveLength(2);
    const treasuryAcctId = await getTreasuryAccountId();
    const treasuryFeeEntries = settleEntries.filter(
      (e) => e.creditAccountId === treasuryAcctId,
    );
    expect(treasuryFeeEntries).toHaveLength(1);
    expect(treasuryFeeEntries[0].amountUnits).toBe(FEE);

    // Deposit forfeit: a separate `dispute-deposit-dispose` tx credits treasury.
    const disposeTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `dispute-deposit-dispose:${dispute.id}` },
    });
    const disposeEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: disposeTx.id },
    });
    expect(disposeEntries).toHaveLength(1);
    expect(disposeEntries[0].creditAccountId).toBe(treasuryAcctId);
    expect(disposeEntries[0].amountUnits).toBe(DEPOSIT);

    // Total treasury delta = fee + deposit forfeit.
    expect((await treasuryBalance()) - treasuryBefore).toBe(FEE + DEPOSIT);

    expect((await userBalance(creator.id)) - creatorBefore).toBe(PAYOUT);
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(0n);

    expect(await betEscrowBalance(bet.id)).toBe(0n);
    expect(await disputeEscrowBalance(dispute.id)).toBe(0n);
  });

  it("OPPONENT_WINS, opener=opponent (winner) — fee 15% to treasury, deposit refund to opener", async () => {
    const creator = await makeUser("ow-win-creator");
    const opponent = await makeUser("ow-win-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute } = await createDisputeReady(creator, opponent, opponent);

    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const treasuryBefore = await treasuryBalance();

    const result = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "OPPONENT_WINS",
      idempotencyKey: newKey(),
    });

    expect(result.dispute.outcome).toBe("OPPONENT_WINS");
    expect(result.bet.status).toBe("SETTLED");
    expect(result.bet.winnerId).toBe(opponent.id);

    const settleTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `dispute-resolve:${dispute.id}` },
    });
    const settleEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: settleTx.id },
    });
    expect(settleEntries).toHaveLength(2);
    const treasuryAcctId = await getTreasuryAccountId();
    const treasuryFeeEntries = settleEntries.filter(
      (e) => e.creditAccountId === treasuryAcctId,
    );
    expect(treasuryFeeEntries).toHaveLength(1);
    expect(treasuryFeeEntries[0].amountUnits).toBe(FEE);

    expect((await treasuryBalance()) - treasuryBefore).toBe(FEE);

    expect((await userBalance(creator.id)) - creatorBefore).toBe(0n);
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(
      PAYOUT + DEPOSIT,
    );

    expect(await betEscrowBalance(bet.id)).toBe(0n);
    expect(await disputeEscrowBalance(dispute.id)).toBe(0n);
  });

  it("OPPONENT_WINS, opener=creator (loser) — fee 15% + deposit forfeit to treasury", async () => {
    const creator = await makeUser("ow-lose-creator");
    const opponent = await makeUser("ow-lose-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute } = await createDisputeReady(creator, opponent, creator);

    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const treasuryBefore = await treasuryBalance();

    const result = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "OPPONENT_WINS",
      idempotencyKey: newKey(),
    });

    expect(result.dispute.outcome).toBe("OPPONENT_WINS");
    expect(result.bet.status).toBe("SETTLED");
    expect(result.bet.winnerId).toBe(opponent.id);

    const settleTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `dispute-resolve:${dispute.id}` },
    });
    const settleEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: settleTx.id },
    });
    expect(settleEntries).toHaveLength(2);
    const treasuryAcctId = await getTreasuryAccountId();
    const treasuryFeeEntries = settleEntries.filter(
      (e) => e.creditAccountId === treasuryAcctId,
    );
    expect(treasuryFeeEntries).toHaveLength(1);
    expect(treasuryFeeEntries[0].amountUnits).toBe(FEE);

    const disposeTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `dispute-deposit-dispose:${dispute.id}` },
    });
    const disposeEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: disposeTx.id },
    });
    expect(disposeEntries).toHaveLength(1);
    expect(disposeEntries[0].creditAccountId).toBe(treasuryAcctId);
    expect(disposeEntries[0].amountUnits).toBe(DEPOSIT);

    expect((await treasuryBalance()) - treasuryBefore).toBe(FEE + DEPOSIT);

    expect((await userBalance(creator.id)) - creatorBefore).toBe(0n);
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(PAYOUT);

    expect(await betEscrowBalance(bet.id)).toBe(0n);
    expect(await disputeEscrowBalance(dispute.id)).toBe(0n);
  });

  it("VOID — both stakes refunded 50/50, deposit refund to opener, treasury delta = 0, bet VOID", async () => {
    const creator = await makeUser("void-creator");
    const opponent = await makeUser("void-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute } = await createDisputeReady(creator, opponent, opponent);

    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const treasuryBefore = await treasuryBalance();

    const result = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "VOID",
      adminNotes: "inconclusive",
      idempotencyKey: newKey(),
    });

    expect(result.dispute.outcome).toBe("VOID");
    expect(result.bet.status).toBe("VOID");
    expect(result.bet.winnerId).toBeNull();

    // VOID uses `dispute-resolve-void:<id>` (not `dispute-resolve:<id>`).
    const settleTx = await prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: `dispute-resolve:${dispute.id}` },
    });
    expect(settleTx).toBeNull();
    const voidTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `dispute-resolve-void:${dispute.id}` },
    });
    const voidEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: voidTx.id },
    });
    expect(voidEntries).toHaveLength(2);
    for (const entry of voidEntries) {
      expect(entry.entryType).toBe("BET_REFUND");
      expect(entry.amountUnits).toBe(STAKE);
    }

    // Deposit refund to opener (= opponent here), credited to opener's user account.
    const disposeTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `dispute-deposit-dispose:${dispute.id}` },
    });
    const disposeEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: disposeTx.id },
    });
    expect(disposeEntries).toHaveLength(1);
    const opponentAcct = await prisma.financialAccount.findUniqueOrThrow({
      where: { scopeKey: `user:${opponent.id}` },
    });
    expect(disposeEntries[0].creditAccountId).toBe(opponentAcct.id);
    expect(disposeEntries[0].amountUnits).toBe(DEPOSIT);

    expect((await treasuryBalance()) - treasuryBefore).toBe(0n);
    expect((await userBalance(creator.id)) - creatorBefore).toBe(STAKE);
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(
      STAKE + DEPOSIT,
    );

    expect(await betEscrowBalance(bet.id)).toBe(0n);
    expect(await disputeEscrowBalance(dispute.id)).toBe(0n);
  });

  it("rejects non-admin caller with DISPUTE_NOT_ADMIN 403 — dispute and bet state unchanged", async () => {
    const creator = await makeUser("na-rs-creator");
    const opponent = await makeUser("na-rs-opponent");
    const { restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute } = await createDisputeReady(creator, opponent, opponent);
    const treasuryBefore = await treasuryBalance();
    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const betEscrowBefore = await betEscrowBalance(bet.id);
    const disputeEscrowBefore = await disputeEscrowBalance(dispute.id);

    await expect(
      resolveDispute({
        disputeId: dispute.id,
        adminId: creator.id, // not in ADMIN_USER_IDS — admin.id is.
        outcome: "CREATOR_WINS",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      name: "DisputeError",
      code: "DISPUTE_NOT_ADMIN",
      statusCode: 403,
    });

    const refreshedDispute = await prisma.dispute.findUniqueOrThrow({
      where: { id: dispute.id },
    });
    expect(refreshedDispute.status).toBe("OPEN");
    expect(refreshedDispute.outcome).toBeNull();
    expect(refreshedDispute.resolvedById).toBeNull();

    const refreshedBet = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
    });
    expect(refreshedBet.status).toBe("DISPUTED");
    expect(refreshedBet.winnerId).toBeNull();

    expect(await treasuryBalance()).toBe(treasuryBefore);
    expect(await userBalance(creator.id)).toBe(creatorBefore);
    expect(await userBalance(opponent.id)).toBe(opponentBefore);
    expect(await betEscrowBalance(bet.id)).toBe(betEscrowBefore);
    expect(await disputeEscrowBalance(dispute.id)).toBe(disputeEscrowBefore);

    expect(
      await prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: `dispute-resolve:${dispute.id}` },
      }),
    ).toBeNull();
    expect(
      await prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: `dispute-resolve-void:${dispute.id}` },
      }),
    ).toBeNull();
  });
});

// ── resolveDispute edge cases (replay + post-RESOLVED reject) ────────

describe("resolveDispute edge cases", () => {
  it("idempotent replay — same key returns cached result, no duplicate ledger tx, treasury unchanged", async () => {
    const creator = await makeUser("rep-creator");
    const opponent = await makeUser("rep-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { dispute } = await createDisputeReady(creator, opponent, creator);
    const treasuryBefore = await treasuryBalance();
    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);

    const key = newKey();
    const result1 = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "CREATOR_WINS",
      idempotencyKey: key,
    });

    const ledgerCountAfter1 = await prisma.ledgerTransaction.count();
    const treasuryAfter1 = await treasuryBalance();
    const creatorAfter1 = await userBalance(creator.id);
    const opponentAfter1 = await userBalance(opponent.id);

    // Winner-opener case: treasury delta = FEE only, no deposit forfeit.
    expect(treasuryAfter1 - treasuryBefore).toBe(FEE);

    const result2 = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "CREATOR_WINS",
      idempotencyKey: key,
    });

    expect(result2.dispute.id).toBe(result1.dispute.id);
    expect(result2.bet.id).toBe(result1.bet.id);
    expect(result2.dispute.outcome).toBe(result1.dispute.outcome);
    expect(result2.bet.status).toBe(result1.bet.status);
    expect(result2.ledgerTxIds).toEqual(result1.ledgerTxIds);

    // No new ledger tx between call 1 and call 2.
    expect(await prisma.ledgerTransaction.count()).toBe(ledgerCountAfter1);

    // Balances unchanged between call 1 and call 2.
    expect(await treasuryBalance()).toBe(treasuryAfter1);
    expect(await userBalance(creator.id)).toBe(creatorAfter1);
    expect(await userBalance(opponent.id)).toBe(opponentAfter1);

    // Net effect across both calls equals the single-resolve outcome.
    expect((await treasuryBalance()) - treasuryBefore).toBe(FEE);
    expect((await userBalance(creator.id)) - creatorBefore).toBe(
      PAYOUT + DEPOSIT,
    );
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(0n);
  });

  it("already RESOLVED dispute — second resolve with different key + different outcome rejects with DISPUTE_INVALID_STATUS 409", async () => {
    const creator = await makeUser("rej-creator");
    const opponent = await makeUser("rej-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute } = await createDisputeReady(creator, opponent, opponent);

    const firstResult = await resolveDispute({
      disputeId: dispute.id,
      adminId: admin.id,
      outcome: "CREATOR_WINS",
      idempotencyKey: newKey(),
    });
    expect(firstResult.dispute.status).toBe("RESOLVED");
    expect(firstResult.dispute.outcome).toBe("CREATOR_WINS");
    expect(firstResult.bet.status).toBe("SETTLED");

    const treasuryAfter1 = await treasuryBalance();
    const creatorAfter1 = await userBalance(creator.id);
    const opponentAfter1 = await userBalance(opponent.id);
    const ledgerCountAfter1 = await prisma.ledgerTransaction.count();

    await expect(
      resolveDispute({
        disputeId: dispute.id,
        adminId: admin.id,
        outcome: "VOID", // try to override with different outcome
        idempotencyKey: newKey(), // and a different key, so not a replay
      }),
    ).rejects.toMatchObject({
      name: "DisputeError",
      code: "DISPUTE_INVALID_STATUS",
      statusCode: 409,
    });

    // First resolution preserved.
    const refreshedDispute = await prisma.dispute.findUniqueOrThrow({
      where: { id: dispute.id },
    });
    expect(refreshedDispute.status).toBe("RESOLVED");
    expect(refreshedDispute.outcome).toBe("CREATOR_WINS");
    expect(refreshedDispute.resolvedById).toBe(admin.id);

    const refreshedBet = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
    });
    expect(refreshedBet.status).toBe("SETTLED");
    expect(refreshedBet.winnerId).toBe(creator.id);

    // No additional ledger tx from the rejected second attempt (rolled back).
    expect(await prisma.ledgerTransaction.count()).toBe(ledgerCountAfter1);
    expect(await treasuryBalance()).toBe(treasuryAfter1);
    expect(await userBalance(creator.id)).toBe(creatorAfter1);
    expect(await userBalance(opponent.id)).toBe(opponentAfter1);
  });
});

// ── forceCancelBet ───────────────────────────────────────────────────

describe("forceCancelBet", () => {
  it("OPEN bet (no opponent yet) — 1 BET_REFUND line to creator, bet CANCELLED", async () => {
    const creator = await makeUser("fc-open-creator");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const created = await createBet({
      creatorId: creator.id,
      creatorSide: "A",
      stakeUnits: STAKE,
      expiresInHours: 24,
      idempotencyKey: newKey(),
    });
    expect(created.bet.status).toBe("OPEN");
    expect(created.bet.opponentUserId).toBeNull();

    const creatorBefore = await userBalance(creator.id);
    expect(await betEscrowBalance(created.bet.id)).toBe(STAKE);

    const result = await forceCancelBet({
      betId: created.bet.id,
      adminId: admin.id,
      reason: "test force cancel on OPEN bet",
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("CANCELLED");
    expect(result.bet.cancelledAt).not.toBeNull();
    expect(result.ledgerTxId).not.toBeNull();

    const refundTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `force-cancel:${created.bet.id}` },
    });
    const refundEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: refundTx.id },
    });
    expect(refundEntries).toHaveLength(1);
    expect(refundEntries[0].entryType).toBe("BET_REFUND");
    expect(refundEntries[0].amountUnits).toBe(STAKE);
    const creatorAcct = await prisma.financialAccount.findUniqueOrThrow({
      where: { scopeKey: `user:${creator.id}` },
    });
    expect(refundEntries[0].creditAccountId).toBe(creatorAcct.id);

    expect((await userBalance(creator.id)) - creatorBefore).toBe(STAKE);
    expect(await betEscrowBalance(created.bet.id)).toBe(0n);

    const transition = await prisma.betStateTransition.findFirst({
      where: { betId: created.bet.id, toStatus: "CANCELLED" },
    });
    expect(transition).not.toBeNull();
    expect(transition!.actorType).toBe("ADMIN_FORCE");
    expect(transition!.actorId).toBe(admin.id);
  });

  it("ACTIVE bet without dispute — 2 BET_REFUND lines, both stakes refunded, bet CANCELLED", async () => {
    const creator = await makeUser("fc-active-creator");
    const opponent = await makeUser("fc-active-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const bet = await createAcceptedBet(creator, opponent);
    expect(bet.status).toBe("ACTIVE");

    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    expect(await betEscrowBalance(bet.id)).toBe(POT);

    const result = await forceCancelBet({
      betId: bet.id,
      adminId: admin.id,
      reason: "active bet force cancel",
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("CANCELLED");
    expect(result.ledgerTxId).not.toBeNull();

    const refundTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `force-cancel:${bet.id}` },
    });
    const refundEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: refundTx.id },
    });
    expect(refundEntries).toHaveLength(2);
    for (const e of refundEntries) {
      expect(e.entryType).toBe("BET_REFUND");
      expect(e.amountUnits).toBe(STAKE);
    }
    const creatorAcct = await prisma.financialAccount.findUniqueOrThrow({
      where: { scopeKey: `user:${creator.id}` },
    });
    const opponentAcct = await prisma.financialAccount.findUniqueOrThrow({
      where: { scopeKey: `user:${opponent.id}` },
    });
    const creditAccounts = new Set(refundEntries.map((e) => e.creditAccountId));
    expect(creditAccounts.has(creatorAcct.id)).toBe(true);
    expect(creditAccounts.has(opponentAcct.id)).toBe(true);

    expect((await userBalance(creator.id)) - creatorBefore).toBe(STAKE);
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(STAKE);
    expect(await betEscrowBalance(bet.id)).toBe(0n);

    const transition = await prisma.betStateTransition.findFirst({
      where: { betId: bet.id, toStatus: "CANCELLED" },
    });
    expect(transition).not.toBeNull();
    expect(transition!.actorType).toBe("ADMIN_FORCE");
    const meta = transition!.metadata as {
      refundedToCreator: boolean;
      refundedToOpponent: boolean;
      disputeVoided: boolean;
    };
    expect(meta.refundedToCreator).toBe(true);
    expect(meta.refundedToOpponent).toBe(true);
    expect(meta.disputeVoided).toBe(false);
  });

  it("DISPUTED bet with open dispute — auto-voids dispute, deposit refund to opener, bet CANCELLED", async () => {
    const creator = await makeUser("fc-disp-creator");
    const opponent = await makeUser("fc-disp-opponent");
    const { admin, restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const { bet, dispute } = await createDisputeReady(creator, opponent, opponent);
    expect(bet.status).toBe("DISPUTED");
    expect(dispute.status).toBe("OPEN");

    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const treasuryBefore = await treasuryBalance();
    expect(await betEscrowBalance(bet.id)).toBe(POT);
    expect(await disputeEscrowBalance(dispute.id)).toBe(DEPOSIT);

    const result = await forceCancelBet({
      betId: bet.id,
      adminId: admin.id,
      reason: "force cancel during dispute",
      idempotencyKey: newKey(),
    });

    expect(result.bet.status).toBe("CANCELLED");

    const refreshedDispute = await prisma.dispute.findUniqueOrThrow({
      where: { id: dispute.id },
    });
    expect(refreshedDispute.status).toBe("RESOLVED");
    expect(refreshedDispute.outcome).toBe("VOID");
    expect(refreshedDispute.resolvedById).toBe(admin.id);
    expect(refreshedDispute.adminNotes).toContain("Auto-voided by force-cancel");

    // Bet refunds: 2 BET_REFUND lines (creator + opponent each = STAKE).
    const refundTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `force-cancel:${bet.id}` },
    });
    const refundEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: refundTx.id },
    });
    expect(refundEntries).toHaveLength(2);
    for (const e of refundEntries) {
      expect(e.entryType).toBe("BET_REFUND");
      expect(e.amountUnits).toBe(STAKE);
    }

    // Deposit refund: dispute escrow → opener (opponent), via dispose-deposit tx.
    const disposeTx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: {
        idempotencyKey: `dispute-deposit-dispose:force-cancel:${dispute.id}`,
      },
    });
    const disposeEntries = await prisma.ledgerEntry.findMany({
      where: { transactionId: disposeTx.id },
    });
    expect(disposeEntries).toHaveLength(1);
    const opponentAcct = await prisma.financialAccount.findUniqueOrThrow({
      where: { scopeKey: `user:${opponent.id}` },
    });
    expect(disposeEntries[0].creditAccountId).toBe(opponentAcct.id);
    expect(disposeEntries[0].amountUnits).toBe(DEPOSIT);

    // Balances: creator +STAKE; opponent +STAKE +DEPOSIT; treasury unchanged.
    expect((await userBalance(creator.id)) - creatorBefore).toBe(STAKE);
    expect((await userBalance(opponent.id)) - opponentBefore).toBe(
      STAKE + DEPOSIT,
    );
    expect((await treasuryBalance()) - treasuryBefore).toBe(0n);

    expect(await betEscrowBalance(bet.id)).toBe(0n);
    expect(await disputeEscrowBalance(dispute.id)).toBe(0n);

    const transition = await prisma.betStateTransition.findFirst({
      where: { betId: bet.id, toStatus: "CANCELLED" },
    });
    expect(transition).not.toBeNull();
    const meta = transition!.metadata as { disputeVoided: boolean };
    expect(meta.disputeVoided).toBe(true);
  });
});

// ── admin gating (forceCancelBet) ────────────────────────────────────

describe("admin gating", () => {
  it("forceCancelBet rejects non-admin caller with DISPUTE_NOT_ADMIN 403 — no state change", async () => {
    const creator = await makeUser("na-fc-creator");
    const opponent = await makeUser("na-fc-opponent");
    const { restore } = await setupAdmin();
    pendingAdminRestore = restore;

    const bet = await createAcceptedBet(creator, opponent);
    const creatorBefore = await userBalance(creator.id);
    const opponentBefore = await userBalance(opponent.id);
    const escrowBefore = await betEscrowBalance(bet.id);

    await expect(
      forceCancelBet({
        betId: bet.id,
        adminId: creator.id, // not in ADMIN_USER_IDS
        reason: "non-admin attempt",
        idempotencyKey: newKey(),
      }),
    ).rejects.toMatchObject({
      name: "DisputeError",
      code: "DISPUTE_NOT_ADMIN",
      statusCode: 403,
    });

    const refreshedBet = await prisma.bet.findUniqueOrThrow({
      where: { id: bet.id },
    });
    expect(refreshedBet.status).toBe("ACTIVE");
    expect(refreshedBet.version).toBe(bet.version);

    expect(await userBalance(creator.id)).toBe(creatorBefore);
    expect(await userBalance(opponent.id)).toBe(opponentBefore);
    expect(await betEscrowBalance(bet.id)).toBe(escrowBefore);

    expect(
      await prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: `force-cancel:${bet.id}` },
      }),
    ).toBeNull();
  });
});
