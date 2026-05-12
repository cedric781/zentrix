import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/bets/read", () => ({
  listBetsAdmin: vi.fn(),
}));

import { GET } from "@/app/api/admin/bets/route";
import { requireAdmin } from "@/lib/admin";
import { listBetsAdmin } from "@/lib/bets/read";
import { mockBet } from "./_fixtures";

const makeReq = (qs = "") => new Request(`http://x/api/admin/bets${qs}`);

describe("GET /api/admin/bets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with offset-pagination envelope", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (listBetsAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [mockBet({ id: "b1" })],
      total: 1,
      offset: 0,
      take: 25,
      hasMore: false,
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].id).toBe("b1");
    expect(json.total).toBe(1);
    expect(json.take).toBe(25);
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
    const res = await GET(makeReq("?take=999"));
    expect(res.status).toBe(400);
  });

  it("status filter accepted", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (listBetsAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      take: 25,
      hasMore: false,
    });
    const res = await GET(makeReq("?status=SETTLED"));
    expect(res.status).toBe(200);
    expect(listBetsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SETTLED" }),
    );
  });
});
