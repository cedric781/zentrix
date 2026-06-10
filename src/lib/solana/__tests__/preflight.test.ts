import { describe, it, expect, vi, beforeEach } from "vitest";

// Two real mainnet-valid base58 addresses (USDC mint + a wallet) so
// parseSolanaAddress and getAssociatedTokenAddressSync accept them. The actual
// ATA bytes are irrelevant — getAccountInfo is fully mocked below.
const OWNER_A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ESCROW = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ── Mocks ────────────────────────────────────────────────────────────
const getAccountInfo = vi.fn();
const getBalance = vi.fn();
const getMinimumBalanceForRentExemption = vi.fn();

vi.mock("@/lib/solana/connection", () => ({
  getSolanaConnection: () => ({
    getAccountInfo,
    getBalance,
    getMinimumBalanceForRentExemption,
  }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    ESCROW_WALLET_ADDRESS: ESCROW,
    USDC_MINT_ADDRESS: USDC_MINT,
  }),
}));

import { assertEscrowSolForAtas, EscrowSolInsufficientError } from "../preflight";

// Real rent for a 165-byte SPL account; well above 0.
const RENT = 2_039_280;
const SIG_BUFFER = 5_000;

beforeEach(() => {
  vi.clearAllMocks();
  getMinimumBalanceForRentExemption.mockResolvedValue(RENT);
});

describe("assertEscrowSolForAtas", () => {
  it("(a) returns required=0 and never throws when no ATA needs creating", async () => {
    // Non-null account info → ATA already exists.
    getAccountInfo.mockResolvedValue({ lamports: 1 });

    const res = await assertEscrowSolForAtas({ destinationOwners: [OWNER_A] });

    expect(res).toEqual({ requiredLamports: 0, balanceLamports: 0, atasToCreate: 0 });
    // Early return: never probes balance or rent.
    expect(getBalance).not.toHaveBeenCalled();
    expect(getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
  });

  it("(b) throws EscrowSolInsufficientError when balance is below required", async () => {
    getAccountInfo.mockResolvedValue(null); // ATA missing → 1 to create
    getBalance.mockResolvedValue(RENT); // below RENT + SIG_BUFFER

    await expect(assertEscrowSolForAtas({ destinationOwners: [OWNER_A] })).rejects.toBeInstanceOf(
      EscrowSolInsufficientError,
    );
  });

  it("(c) returns the three numbers when balance covers required", async () => {
    getAccountInfo.mockResolvedValue(null); // 1 to create
    getBalance.mockResolvedValue(RENT + SIG_BUFFER + 1); // just above required

    const res = await assertEscrowSolForAtas({ destinationOwners: [OWNER_A] });

    expect(res.atasToCreate).toBe(1);
    expect(res.requiredLamports).toBe(RENT + SIG_BUFFER);
    expect(res.balanceLamports).toBe(RENT + SIG_BUFFER + 1);
  });

  it("(d) falls back to the constant when getMinimumBalanceForRentExemption throws", async () => {
    getAccountInfo.mockResolvedValue(null); // 1 to create
    getMinimumBalanceForRentExemption.mockRejectedValue(new Error("RPC down"));
    // Balance exactly at fallback required → no throw, confirms fallback was used.
    getBalance.mockResolvedValue(RENT + SIG_BUFFER);

    const res = await assertEscrowSolForAtas({ destinationOwners: [OWNER_A] });

    expect(res.atasToCreate).toBe(1);
    expect(res.requiredLamports).toBe(RENT + SIG_BUFFER); // fallback constant + buffer
    expect(res.balanceLamports).toBe(RENT + SIG_BUFFER);
  });
});
