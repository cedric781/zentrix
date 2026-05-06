import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({
    get: () => ({ value: "mock-token" }),
  }),
}));

vi.mock("@/lib/privy/server", () => ({
  getPrivyServerClient: () => ({
    verifyAuthToken: vi.fn().mockResolvedValue({ userId: "did:privy:test-abc123" }),
    getUserById: vi.fn().mockResolvedValue({
      email: { address: "test@example.com" },
      linkedAccounts: [
        {
          type: "wallet",
          chainType: "solana",
          walletClientType: "privy",
          address: "FAKE_SOLANA_ADDRESS_FOR_TEST",
        },
      ],
    }),
  }),
}));

import { getCurrentUser } from "@/lib/auth";

describe("getCurrentUser", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.ledgerTransaction.deleteMany();
    await prisma.financialAccount.deleteMany({ where: { accountType: "USER" } });
    await prisma.user.deleteMany();
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
});