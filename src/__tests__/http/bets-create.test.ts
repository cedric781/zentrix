import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/service", () => ({
  createBet: vi.fn(),
}));

import { POST } from "@/app/api/bets/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { createBet } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";
import { mockBet, makeReq, VALID_UUID } from "./_fixtures";

describe("POST /api/bets", () => {
  beforeEach(() => vi.clearAllMocks());

  const validBody = {
    side: "A",
    stakeUnits: "1000",
    expiresInHours: 24,
    title: "Test bet",
    outcomeA: "A wins",
    outcomeB: "B wins",
  };

  it("A. happy path → 200 with serialized bet + inviteToken", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (createBet as ReturnType<typeof vi.fn>).mockResolvedValue({
      bet: mockBet({ stakeUnits: 1000n }),
      inviteToken: "tok-abc",
    });

    const res = await POST(
      makeReq("http://x/api/bets", validBody, { "idempotency-key": VALID_UUID }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bet.id).toBe("bet-1");
    expect(json.bet.stakeUnits).toBe("1000");
    expect(json.inviteToken).toBe("tok-abc");
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(makeReq("http://x/api/bets", validBody));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. bad body → 400 bad_body with issues", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await POST(
      makeReq("http://x/api/bets", { side: "X", stakeUnits: "abc" }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad_body");
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
  });

  it("D. service BetError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (createBet as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BetError("BET_INVALID_INPUT", "stake too low", 400),
    );

    const res = await POST(makeReq("http://x/api/bets", validBody));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("BET_INVALID_INPUT");
    expect(json.message).toBe("stake too low");
  });
});
