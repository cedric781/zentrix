import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/reputation/read", () => ({
  getUserReputation: vi.fn(),
}));

import { GET } from "@/app/api/me/reputation/route";
import { requireCurrentUser } from "@/lib/auth";
import { getUserReputation } from "@/lib/reputation/read";

const T0 = new Date("2026-05-12T10:00:00.000Z");

const mockRep = () => ({
  id: "r1",
  userId: "u1",
  score: 500,
  tier: "NORMAL" as const,
  disputesOpened: 0,
  disputesWon: 0,
  disputesLost: 0,
  lastUpdatedAt: T0,
});

describe("GET /api/me/reputation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with rep data", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getUserReputation as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRep(),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.userId).toBe("u1");
    expect(json.data.score).toBe(500);
    expect(json.data.tier).toBe("NORMAL");
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
