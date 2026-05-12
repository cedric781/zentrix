import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/read", () => ({
  getBet: vi.fn(),
}));

import { GET } from "@/app/api/bets/[id]/route";
import { requireCurrentUser } from "@/lib/auth";
import { getBet } from "@/lib/bets/read";
import { mockBet } from "./_fixtures";

const makeReq = () => new Request("http://x/api/bets/b1");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/bets/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with data:serializedBet", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getBet as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockBet({ id: "b1" }),
    );
    const res = await GET(makeReq(), ctx("b1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("b1");
  });

  it("unauthorized → 401", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );
    const res = await GET(makeReq(), ctx("b1"));
    expect(res.status).toBe(401);
  });

  it("not found / not owner → 404", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getBet as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeReq(), ctx("b1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });
});
