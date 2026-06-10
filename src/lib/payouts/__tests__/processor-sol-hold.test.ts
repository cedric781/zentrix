import { describe, it, expect, vi, beforeEach } from "vitest";

// Routing tests for the SOL preflight in processPendingPayout. These mock the
// preflight module wholesale (forcing assertEscrowSolForAtas to throw), so they
// live apart from solana/__tests__/preflight.test.ts which exercises the REAL
// assertEscrowSolForAtas. DB + Connection are fully mocked — no real RPC/DB.

const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WALLET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ── Mocks ────────────────────────────────────────────────────────────
const prisma = vi.hoisted(() => ({
  bet: { updateMany: vi.fn(), update: vi.fn() },
  ledgerEntry: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  betStateTransition: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma }));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    ESCROW_WALLET_ADDRESS: WALLET,
    FEE_WALLET_ADDRESS: WALLET, // single-wallet → preflight owner is just the winner
    USDC_MINT_ADDRESS: USDC_MINT,
    ESCROW_WALLET_ID: "escrow-wallet-id",
  }),
}));

vi.mock("@/lib/solana/connection", () => ({ getSolanaConnection: () => ({}) }));

// Keep the REAL EscrowSolInsufficientError class (so `instanceof` in the
// processor matches) and mock ONLY assertEscrowSolForAtas.
vi.mock("@/lib/solana/preflight", async (importActual) => {
  const actual = await importActual<typeof import("../../solana/preflight")>();
  return { ...actual, assertEscrowSolForAtas: vi.fn() };
});

import { processBetPayout, type PayoutBetInput } from "../processor";
import { assertEscrowSolForAtas, EscrowSolInsufficientError } from "@/lib/solana/preflight";

const RETRY_COUNT = 3;

function makeBet(): PayoutBetInput {
  return {
    id: "bet-1",
    winnerId: "winner-1",
    escrowLockedAt: new Date(),
    onChainPayoutStatus: "PENDING",
    payoutWinnerTxSig: null,
    payoutFeeTxSig: null,
    payoutRetryCount: RETRY_COUNT,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // CAS claim wins.
  prisma.bet.updateMany.mockResolvedValue({ count: 1 });
  // Winner settle entry present; no fee entry.
  prisma.ledgerEntry.findFirst
    .mockResolvedValueOnce({ amountUnits: 1_000_000n }) // winner
    .mockResolvedValueOnce(null); // fee
  prisma.user.findUnique.mockResolvedValue({ embeddedWalletAddress: OWNER });
  prisma.bet.update.mockResolvedValue({});
});

describe("processPendingPayout — SOL preflight routing", () => {
  it("(e) markSolHold writes FAILED with a future recheck and an UNCHANGED retry counter", async () => {
    vi.mocked(assertEscrowSolForAtas).mockRejectedValue(
      new EscrowSolInsufficientError(2_044_280, 0, 1),
    );

    const outcome = await processBetPayout(makeBet());

    expect(prisma.bet.update).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.bet.update.mock.calls[0][0];
    expect(where).toEqual({ id: "bet-1" });
    expect(data.onChainPayoutStatus).toBe("FAILED");
    expect(data.payoutNextRetryAt).toBeInstanceOf(Date);
    expect(data.payoutNextRetryAt.getTime()).toBeGreaterThan(Date.now());
    // The freeze: payoutRetryCount is never written by a SOL hold.
    expect(data).not.toHaveProperty("payoutRetryCount");
    expect(outcome).toMatchObject({ outcome: "failed", betId: "bet-1", retryCount: RETRY_COUNT });
  });

  it("(f) insufficient-SOL routes to markSolHold, NOT markRetryOrTerminal (no increment)", async () => {
    vi.mocked(assertEscrowSolForAtas).mockRejectedValue(
      new EscrowSolInsufficientError(2_044_280, 0, 1),
    );

    await processBetPayout(makeBet());

    expect(prisma.bet.update).toHaveBeenCalledTimes(1);
    const { data } = prisma.bet.update.mock.calls[0][0];
    // markRetryOrTerminal would set `payoutRetryCount: { increment: 1 }`.
    expect(data.payoutRetryCount).toBeUndefined();
  });

  it("(g) a generic RPC error routes to markRetryOrTerminal (counter increments)", async () => {
    vi.mocked(assertEscrowSolForAtas).mockRejectedValue(new Error("RPC 503"));

    await processBetPayout(makeBet());

    expect(prisma.bet.update).toHaveBeenCalledTimes(1);
    const { data } = prisma.bet.update.mock.calls[0][0];
    expect(data.payoutRetryCount).toEqual({ increment: 1 });
    expect(data.onChainPayoutStatus).toBe("FAILED");
    expect(data.payoutNextRetryAt).toBeInstanceOf(Date);
  });
});
