import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/service", () => ({
  acceptBet: vi.fn(),
}));

import { POST } from "@/app/api/bets/[id]/accept/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { acceptBet } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";
import { mockBet, makeReq, VALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "bet-1" }) };
const validBody = { inviteToken: "aaaaaaaaaaaaaaaa" };

describe("POST /api/bets/[id]/accept", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with serialized bet", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u2" });
    (acceptBet as ReturnType<typeof vi.fn>).mockResolvedValue({
      bet: mockBet({ opponentUserId: "u2", status: "ACTIVE" }),
    });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/accept", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bet.id).toBe("bet-1");
    expect(json.bet.opponentUserId).toBe("u2");
    expect(json.bet.status).toBe("ACTIVE");
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(makeReq("http://x/api/bets/bet-1/accept", validBody), params);

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. bad body → 400 (inviteToken too short)", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u2" });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/accept", { inviteToken: "short" }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("D. service BetError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u2" });
    (acceptBet as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BetError("BET_ALREADY_ACCEPTED", "bet already accepted", 409),
    );

    const res = await POST(makeReq("http://x/api/bets/bet-1/accept", validBody), params);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("BET_ALREADY_ACCEPTED");
    expect(json.message).toBe("bet already accepted");
  });
});
