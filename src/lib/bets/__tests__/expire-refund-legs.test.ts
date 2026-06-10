import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the ledger + reputation collaborators so expire.ts runs without a DB.
const recordTransaction = vi.hoisted(() => vi.fn());
const getUserAccount = vi.hoisted(() => vi.fn());
const trackReputationEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ledger", () => ({ recordTransaction, getUserAccount }));
vi.mock("@/lib/reputation/service", () => ({ trackReputationEvent }));

import { expireOpenBet, autoVoidProposedBet } from "../expire";

const PAST = new Date("2020-01-01T00:00:00.000Z");

// A minimal TxClient mock — only the methods expire.ts touches.
function makeTx(bet: Record<string, unknown>, entries: Array<{ id: string; creditAccountId: string; amountUnits: bigint }>) {
  return {
    bet: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(bet),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    financialAccount: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "escrow-acct" }),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ embeddedWalletAddress: where.id === "u1" ? "WalletCreator11" : "WalletOpponent22" }),
      ),
    },
    ledgerEntry: {
      findMany: vi.fn().mockResolvedValue(entries),
    },
    betStateTransition: { create: vi.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recordTransaction.mockResolvedValue({ transaction: { id: "ledger-tx-1" }, replayed: false });
  getUserAccount.mockImplementation((_tx: unknown, userId: string) =>
    Promise.resolve({ id: userId === "u1" ? "acct-c" : "acct-o" }),
  );
  trackReputationEvent.mockResolvedValue({ event: { id: "rep-1" } });
});

describe("expireOpenBet — refundLegs wiring (single-sided)", () => {
  it("sets onChainRefundStatus=PENDING and one creator leg on the bet update", async () => {
    const bet = { id: "bet-1", status: "OPEN", expiresAt: PAST, createdById: "u1", version: 1, stakeUnits: 1000n };
    const tx = makeTx(bet, [{ id: "entry-c", creditAccountId: "acct-c", amountUnits: 1000n }]);

    // @ts-expect-error partial TxClient mock is sufficient for this code path
    await expireOpenBet("bet-1", tx);

    expect(tx.bet.updateMany).toHaveBeenCalledTimes(1);
    const { data } = tx.bet.updateMany.mock.calls[0][0];
    expect(data.status).toBe("EXPIRED");
    expect(data.onChainRefundStatus).toBe("PENDING");
    expect(data.refundLegs).toEqual([
      { side: "creator", destOwner: "WalletCreator11", amountUnits: "1000", ledgerEntryId: "entry-c", txSig: null, status: "pending" },
    ]);
  });
});

describe("autoVoidProposedBet — refundLegs wiring (double-sided)", () => {
  it("sets onChainRefundStatus=PENDING and two legs (creator-first)", async () => {
    const bet = {
      id: "bet-1", status: "RESULT_PROPOSED", confirmDeadline: PAST,
      createdById: "u1", opponentUserId: "u2", version: 1, stakeUnits: 1000n,
    };
    const tx = makeTx(bet, [
      { id: "entry-o", creditAccountId: "acct-o", amountUnits: 1000n },
      { id: "entry-c", creditAccountId: "acct-c", amountUnits: 1000n },
    ]);

    // @ts-expect-error partial TxClient mock is sufficient for this code path
    await autoVoidProposedBet("bet-1", tx);

    expect(tx.bet.updateMany).toHaveBeenCalledTimes(1);
    const { data } = tx.bet.updateMany.mock.calls[0][0];
    expect(data.status).toBe("VOID");
    expect(data.onChainRefundStatus).toBe("PENDING");
    expect(data.refundLegs.map((l: { side: string }) => l.side)).toEqual(["creator", "opponent"]);
    expect(data.refundLegs[0]).toMatchObject({ ledgerEntryId: "entry-c", destOwner: "WalletCreator11" });
    expect(data.refundLegs[1]).toMatchObject({ ledgerEntryId: "entry-o", destOwner: "WalletOpponent22" });
  });
});

describe("re-run does not overwrite existing refundLegs", () => {
  it("a non-OPEN bet throws at the status guard before the leg setter runs", async () => {
    // Simulates a second expire pass: status already moved past OPEN, so the
    // version+status-guarded update (which carries the refund fields) is never
    // reached and existing refundLegs are left untouched.
    const bet = { id: "bet-1", status: "EXPIRED", expiresAt: PAST, createdById: "u1", version: 2, stakeUnits: 1000n };
    const tx = makeTx(bet, [{ id: "entry-c", creditAccountId: "acct-c", amountUnits: 1000n }]);

    // @ts-expect-error partial TxClient mock is sufficient for this code path
    await expect(expireOpenBet("bet-1", tx)).rejects.toThrow(/Cannot expire bet in status/);
    expect(tx.bet.updateMany).not.toHaveBeenCalled();
    expect(recordTransaction).not.toHaveBeenCalled();
  });
});
