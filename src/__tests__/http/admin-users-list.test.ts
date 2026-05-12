import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/admin/users", () => ({
  listUsersAdmin: vi.fn(),
}));

import { GET } from "@/app/api/admin/users/route";
import { requireAdmin } from "@/lib/admin";
import { listUsersAdmin } from "@/lib/admin/users";

const T0 = new Date("2026-05-12T10:00:00.000Z");

const mockUserWithAccount = () => ({
  id: "u1",
  privyId: "did:privy:123",
  email: "u1@example.com",
  embeddedWalletAddress: "Ab123...",
  createdAt: T0,
  updatedAt: T0,
  financialAccount: {
    id: "fa1",
    accountType: "USER" as const,
    scopeKey: "user:u1",
    userId: "u1",
    balanceUnits: 1000n,
    label: null,
    createdAt: T0,
    updatedAt: T0,
  },
});

const makeReq = (qs = "") => new Request(`http://x/api/admin/users${qs}`);

describe("GET /api/admin/users", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with items including financialAccount (balanceUnits as string)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (listUsersAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [mockUserWithAccount()],
      total: 1,
      offset: 0,
      take: 25,
      hasMore: false,
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].id).toBe("u1");
    expect(json.items[0].financialAccount.balanceUnits).toBe("1000");
    expect(typeof json.items[0].financialAccount.balanceUnits).toBe("string");
    expect(json.total).toBe(1);
  });

  it("admin auth fail → 401", async () => {
    const { AdminAuthError } = await import("@/lib/admin");
    (requireAdmin as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AdminAuthError(),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("offset/take clamping (take > 100 → 400)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const res = await GET(makeReq("?take=200"));
    expect(res.status).toBe(400);
  });

  it("searchQ accepted (passed through to service, NOT enforced in WHERE)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (listUsersAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      take: 25,
      hasMore: false,
    });
    const res = await GET(makeReq("?searchQ=rapha"));
    expect(res.status).toBe(200);
    expect(listUsersAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ searchQ: "rapha" }),
    );
  });
});
