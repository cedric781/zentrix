import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/matches/read", () => ({
  getMatch: vi.fn(),
}));

import { GET } from "@/app/api/matches/[id]/route";
import { requireCurrentUser } from "@/lib/auth";
import { getMatch } from "@/lib/matches/read";
import { mockBet, mockMatch } from "./_fixtures";

const T0 = new Date("2026-05-12T10:00:00.000Z");

const mockPool = (): Pool => ({
  id: "p1",
  createdById: "u1",
  title: "Pool 1",
  description: null,
  status: "OPEN",
  bettingClosesAt: T0,
  createdAt: T0,
  updatedAt: T0,
});

const mockMatchWithRelations = () => ({
  ...mockMatch({ id: "m1", poolId: "p1" }),
  pool: mockPool(),
  bets: [mockBet({ id: "b1", matchId: "m1" })],
});

const makeReq = () => new Request("http://x/api/matches/m1");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/matches/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with data including pool + bets", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getMatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockMatchWithRelations(),
    );
    const res = await GET(makeReq(), ctx("m1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("m1");
    expect(json.data.pool.id).toBe("p1");
    expect(json.data.bets).toHaveLength(1);
  });

  it("unauthorized → 401", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );
    const res = await GET(makeReq(), ctx("m1"));
    expect(res.status).toBe(401);
  });

  it("not found / not owner → 404", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getMatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeReq(), ctx("m1"));
    expect(res.status).toBe(404);
  });
});
