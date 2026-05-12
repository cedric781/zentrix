import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/pools/read", () => ({
  getPool: vi.fn(),
}));

import { GET } from "@/app/api/pools/[id]/route";
import { requireCurrentUser } from "@/lib/auth";
import { getPool } from "@/lib/pools/read";
import { mockMatch } from "./_fixtures";

const T0 = new Date("2026-05-12T10:00:00.000Z");

const mockPoolWithMatches = (overrides: Partial<Pool> = {}) => ({
  id: "p1",
  createdById: "u1",
  title: "Test Pool",
  description: null,
  status: "DRAFT" as const,
  bettingClosesAt: T0,
  createdAt: T0,
  updatedAt: T0,
  matches: [mockMatch({ id: "m1", poolId: "p1" })],
  ...overrides,
});

const makeReq = () => new Request("http://x/api/pools/p1");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/pools/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with data including matches", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getPool as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockPoolWithMatches(),
    );
    const res = await GET(makeReq(), ctx("p1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("p1");
    expect(json.data.matches).toHaveLength(1);
    expect(json.data.matches[0].id).toBe("m1");
  });

  it("unauthorized → 401", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );
    const res = await GET(makeReq(), ctx("p1"));
    expect(res.status).toBe(401);
  });

  it("not found / not owner → 404", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (getPool as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeReq(), ctx("p1"));
    expect(res.status).toBe(404);
  });
});
