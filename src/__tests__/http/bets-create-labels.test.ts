import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/service", () => ({
  createBet: vi.fn(),
}));

import { POST } from "@/app/api/bets/route";
import { requireCurrentUser } from "@/lib/auth";
import { createBet } from "@/lib/bets/service";
import { mockBet, makeReq, VALID_UUID } from "./_fixtures";

describe("POST /api/bets — label validation (P19)", () => {
  beforeEach(() => vi.clearAllMocks());

  const baseValid = {
    side: "A",
    stakeUnits: "1000",
    expiresInHours: 24,
    title: "Test bet",
    outcomeA: "A wins",
    outcomeB: "B wins",
  };

  function call(body: Record<string, unknown>) {
    return POST(
      makeReq("http://x/api/bets", body, { "idempotency-key": VALID_UUID }),
    );
  }

  it("accepts valid title + outcomes → 200", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (createBet as ReturnType<typeof vi.fn>).mockResolvedValue({
      bet: mockBet({
        stakeUnits: 1000n,
        title: "Test bet",
        outcomeA: "A wins",
        outcomeB: "B wins",
      }),
      inviteToken: "tok-abc",
    });

    const res = await call(baseValid);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bet.title).toBe("Test bet");
    expect(json.bet.outcomeA).toBe("A wins");
    expect(json.bet.outcomeB).toBe("B wins");
  });

  it("rejects empty title → 400 bad_body", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await call({ ...baseValid, title: "" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad_body");
    expect(json.issues.some((i: { path: (string | number)[] }) => i.path.includes("title"))).toBe(
      true,
    );
  });

  it("rejects title longer than 200 chars → 400 bad_body", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await call({ ...baseValid, title: "x".repeat(201) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad_body");
    expect(json.issues.some((i: { path: (string | number)[] }) => i.path.includes("title"))).toBe(
      true,
    );
  });

  it("rejects empty outcomeA → 400 bad_body", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await call({ ...baseValid, outcomeA: "" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad_body");
    expect(
      json.issues.some((i: { path: (string | number)[] }) => i.path.includes("outcomeA")),
    ).toBe(true);
  });

  it("rejects outcomeB longer than 100 chars → 400 bad_body", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await call({ ...baseValid, outcomeB: "x".repeat(101) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad_body");
    expect(
      json.issues.some((i: { path: (string | number)[] }) => i.path.includes("outcomeB")),
    ).toBe(true);
  });
});
