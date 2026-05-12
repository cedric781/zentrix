import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/read", () => ({
  listBets: vi.fn(),
}));

import { GET } from "@/app/api/bets/route";
import { requireCurrentUser } from "@/lib/auth";
import { listBets } from "@/lib/bets/read";
import { InvalidCursorError } from "@/lib/http/pagination";
import { mockBet } from "./_fixtures";

const makeReq = (qs = "") => new Request(`http://x/api/bets${qs}`);

describe("GET /api/bets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with serialized items + nextCursor", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (listBets as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [mockBet({ id: "b1" })],
      nextCursor: "cursor-x",
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe("b1");
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
    (listBets as ReturnType<typeof vi.fn>).mockRejectedValue(
      new InvalidCursorError(),
    );
    const res = await GET(makeReq("?cursor=bad"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_CURSOR");
  });

  it("empty result → 200 with items:[], nextCursor:null", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (listBets as ReturnType<typeof vi.fn>).mockResolvedValue({
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
