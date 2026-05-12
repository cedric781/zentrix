import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/disputes/read", () => ({
  getDispute: vi.fn(),
}));

import { GET } from "@/app/api/disputes/[id]/route";
import { requireCurrentUser } from "@/lib/auth";
import { getDispute } from "@/lib/disputes/read";
import { mockBet, mockDispute } from "./_fixtures";

const makeReq = () => new Request("http://x/api/disputes/d1");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/disputes/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with data including bet", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getDispute as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockDispute({ id: "d1", betId: "b1" }),
      bet: mockBet({ id: "b1" }),
    });
    const res = await GET(makeReq(), ctx("d1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("d1");
    expect(json.data.bet.id).toBe("b1");
  });

  it("unauthorized → 401", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );
    const res = await GET(makeReq(), ctx("d1"));
    expect(res.status).toBe(401);
  });

  it("not found / not owner → 404", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getDispute as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeReq(), ctx("d1"));
    expect(res.status).toBe(404);
  });
});
