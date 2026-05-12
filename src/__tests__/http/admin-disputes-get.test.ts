import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/disputes/read", () => ({
  getDispute: vi.fn(),
}));

import { GET } from "@/app/api/admin/disputes/[id]/route";
import { requireAdmin } from "@/lib/admin";
import { getDispute } from "@/lib/disputes/read";
import { mockBet, mockDispute } from "./_fixtures";

const makeReq = () => new Request("http://x/api/admin/disputes/d1");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/admin/disputes/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with data + bet (no userId filter)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (getDispute as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockDispute({ id: "d1", betId: "b1" }),
      bet: mockBet({ id: "b1" }),
    });
    const res = await GET(makeReq(), ctx("d1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("d1");
    expect(json.data.bet.id).toBe("b1");
    expect(getDispute).toHaveBeenCalledWith({ id: "d1" });
  });

  it("admin auth fail → 401", async () => {
    const { AdminAuthError } = await import("@/lib/admin");
    (requireAdmin as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AdminAuthError(),
    );
    const res = await GET(makeReq(), ctx("d1"));
    expect(res.status).toBe(401);
  });

  it("not found → 404", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (getDispute as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeReq(), ctx("d1"));
    expect(res.status).toBe(404);
  });

  it("calls getDispute without userId (admin visibility)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (getDispute as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockDispute(),
      bet: mockBet(),
    });
    await GET(makeReq(), ctx("d1"));
    const call = (getDispute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.userId).toBeUndefined();
  });
});
