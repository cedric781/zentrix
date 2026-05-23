import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/pools/read", () => ({
  listPools: vi.fn(),
}));

import { GET } from "@/app/api/pools/route";
import { requireCurrentUser } from "@/lib/auth";
import { listPools } from "@/lib/pools/read";
import { InvalidCursorError } from "@/lib/http/pagination";

const T0 = new Date("2026-05-12T10:00:00.000Z");

const mockPool = (overrides: Partial<Pool> = {}): Pool => ({
  id: "p1",
  createdById: "u1",
  title: "Test Pool",
  description: null,
  status: "DRAFT",
  tournamentFormat: "SIMPLE",
  bettingClosesAt: T0,
  bracketLockedAt: null,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

const makeReq = (qs = "") => new Request(`http://x/api/pools${qs}`);

describe("GET /api/pools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with items + nextCursor", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (listPools as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [mockPool({ id: "p1" })],
      nextCursor: "cursor-x",
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].id).toBe("p1");
    expect(json.items[0].title).toBe("Test Pool");
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
    (listPools as ReturnType<typeof vi.fn>).mockRejectedValue(
      new InvalidCursorError(),
    );
    const res = await GET(makeReq("?cursor=bad"));
    expect(res.status).toBe(400);
  });

  it("empty result → 200 items:[]", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "u1",
    });
    (listPools as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
  });
});
