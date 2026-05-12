import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/service", () => ({
  proposeResult: vi.fn(),
}));

import { POST } from "@/app/api/bets/[id]/propose-result/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { proposeResult } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";
import { mockBet, mockClaim, makeReq, VALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "bet-1" }) };
const validBody = { claimedWinnerId: "u1", note: "I won fair and square" };

describe("POST /api/bets/[id]/propose-result", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with bet + claim", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (proposeResult as ReturnType<typeof vi.fn>).mockResolvedValue({
      bet: mockBet({ status: "RESULT_PROPOSED", resultStatus: "PROPOSED" }),
      claim: mockClaim({ note: "I won fair and square" }),
    });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/propose-result", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bet.status).toBe("RESULT_PROPOSED");
    expect(json.claim.id).toBe("claim-1");
    expect(json.claim.claimedWinnerId).toBe("u1");
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/propose-result", validBody),
      params,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. bad body → 400 (missing claimedWinnerId)", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/propose-result", { note: "no winner" }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("D. service BetError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (proposeResult as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BetError("BET_NOT_PARTICIPANT", "not a participant", 403),
    );

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/propose-result", validBody),
      params,
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("BET_NOT_PARTICIPANT");
    expect(json.message).toBe("not a participant");
  });
});
