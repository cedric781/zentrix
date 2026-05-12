import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/disputes/read", () => ({
  listDisputesAdmin: vi.fn(),
}));

import { GET } from "@/app/api/admin/disputes/route";
import { requireAdmin } from "@/lib/admin";
import { listDisputesAdmin } from "@/lib/disputes/read";
import { mockBet, mockDispute } from "./_fixtures";

const makeReq = (qs = "") => new Request(`http://x/api/admin/disputes${qs}`);

describe("GET /api/admin/disputes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with items + total/offset/take/hasMore", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (listDisputesAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ ...mockDispute({ id: "d1" }), bet: mockBet({ id: "b1" }) }],
      total: 1,
      offset: 0,
      take: 25,
      hasMore: false,
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe("d1");
    expect(json.items[0].bet.id).toBe("b1");
    expect(json.total).toBe(1);
    expect(json.offset).toBe(0);
    expect(json.take).toBe(25);
    expect(json.hasMore).toBe(false);
  });

  it("admin auth fail → 401", async () => {
    const { AdminAuthError } = await import("@/lib/admin");
    (requireAdmin as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AdminAuthError("no token"),
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
    (listDisputesAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      take: 25,
      hasMore: false,
    });
    const res = await GET(makeReq("?status=OPEN"));
    expect(res.status).toBe(200);
    expect(listDisputesAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OPEN" }),
    );
  });
});
