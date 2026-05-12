import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: {
      findUnique: vi.fn(),
    },
  },
}));

import { GET } from "@/app/api/me/balance/route";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const T0 = new Date("2026-05-12T10:00:00.000Z");

const mockFA = () => ({
  id: "fa1",
  accountType: "USER",
  scopeKey: "user:u1",
  userId: "u1",
  balanceUnits: 1000000n,
  label: null,
  createdAt: T0,
  updatedAt: T0,
});

describe("GET /api/me/balance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with serialized balance as string", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (prisma.financialAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFA(),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("fa1");
    expect(json.data.balanceUnits).toBe("1000000");
    expect(typeof json.data.balanceUnits).toBe("string");
  });

  it("unauthorized → 401", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
