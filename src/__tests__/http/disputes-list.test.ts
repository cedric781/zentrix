import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/disputes/read", () => ({
  listDisputes: vi.fn(),
}));

import { GET } from "@/app/api/disputes/route";
import { requireCurrentUser } from "@/lib/auth";
import { listDisputes } from "@/lib/disputes/read";
import { InvalidCursorError } from "@/lib/http/pagination";
import { mockBet, mockDispute } from "./_fixtures";

const makeReq = (qs = "") => new Request(`http://x/api/disputes${qs}`);

describe("GET /api/disputes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with items containing dispute + bet", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (listDisputes as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        {
          ...mockDispute({ id: "d1", betId: "b1" }),
          bet: mockBet({ id: "b1" }),
        },
      ],
      nextCursor: "cursor-x",
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe("d1");
    expect(json.items[0].bet.id).toBe("b1");
    expect(json.nextCursor).toBe("cursor-x");
  });

  it("unauthorized → 401", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("invalid cursor → 400 INVALID_CURSOR", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (listDisputes as ReturnType<typeof vi.fn>).mockRejectedValue(
      new InvalidCursorError(),
    );
    const res = await GET(makeReq("?cursor=bad"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_CURSOR");
  });

  it("empty result → 200 items:[]", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (listDisputes as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
    expect(json.nextCursor).toBeNull();
  });
});
