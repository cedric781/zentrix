import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

const { mockGetUserById, mockVerifyAuthToken } = vi.hoisted(() => ({
  mockGetUserById: vi.fn(),
  mockVerifyAuthToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({
    get: () => ({ value: "mock-token" }),
  }),
}));

vi.mock("@/lib/privy/server", () => ({
  getPrivyServerClient: () => ({
    verifyAuthToken: mockVerifyAuthToken,
    getUserById: mockGetUserById,
  }),
}));

import { getCurrentUser } from "@/lib/auth";

const FULL_PRIVY_USER = {
  email: { address: "test@example.com" },
  linkedAccounts: [
    {
      type: "wallet",
      chainType: "solana",
      walletClientType: "privy",
      address: "FAKE_SOLANA_ADDRESS_FOR_TEST",
    },
  ],
};

const EMPTY_PRIVY_USER = {
  email: null,
  linkedAccounts: [],
};

describe("getCurrentUser", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.ledgerTransaction.deleteMany();
    await prisma.financialAccount.deleteMany({ where: { accountType: "USER" } });
    await prisma.user.deleteMany();

    mockVerifyAuthToken.mockReset();
    mockVerifyAuthToken.mockResolvedValue({ userId: "did:privy:test-abc123" });
    mockGetUserById.mockReset();
    mockGetUserById.mockResolvedValue(FULL_PRIVY_USER);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a User and FinancialAccount on first call", async () => {
    const u1 = await getCurrentUser();
    expect(u1).not.toBeNull();
    expect(u1!.privyId).toBe("did:privy:test-abc123");

    const fa = await prisma.financialAccount.findUnique({
      where: { scopeKey: `user:${u1!.id}` },
    });
    expect(fa).not.toBeNull();
    expect(fa!.accountType).toBe("USER");
  });

  it("is idempotent — second call returns same User without duplicating account", async () => {
    const u1 = await getCurrentUser();
    const u2 = await getCurrentUser();
    expect(u2!.id).toBe(u1!.id);

    const accountCount = await prisma.financialAccount.count({
      where: { userId: u1!.id },
    });
    expect(accountCount).toBe(1);
  });

  it("refreshes null fields on subsequent calls", async () => {
    // Call 1: Privy hasn't provisioned the embedded wallet yet, no email either.
    mockGetUserById.mockResolvedValueOnce(EMPTY_PRIVY_USER);
    const u1 = await getCurrentUser();
    expect(u1).not.toBeNull();
    expect(u1!.email).toBeNull();
    expect(u1!.embeddedWalletAddress).toBeNull();

    // Call 2: Privy now returns the wallet + email; the row must be updated.
    const u2 = await getCurrentUser();
    expect(u2!.id).toBe(u1!.id);
    expect(u2!.email).toBe("test@example.com");
    expect(u2!.embeddedWalletAddress).toBe("FAKE_SOLANA_ADDRESS_FOR_TEST");

    // Verify the update is persisted in the DB, not just on the returned object.
    const fromDb = await prisma.user.findUnique({ where: { id: u1!.id } });
    expect(fromDb!.email).toBe("test@example.com");
    expect(fromDb!.embeddedWalletAddress).toBe("FAKE_SOLANA_ADDRESS_FOR_TEST");

    // Call 3: row is fully populated. No re-fetch from Privy, no DB write.
    const callsBefore = mockGetUserById.mock.calls.length;
    const u3 = await getCurrentUser();
    expect(u3!.id).toBe(u1!.id);
    expect(u3!.updatedAt.getTime()).toBe(u2!.updatedAt.getTime());
    expect(mockGetUserById.mock.calls.length).toBe(callsBefore);
  });
});
