import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/service", () => ({
  confirmResult: vi.fn(),
}));

import { POST } from "@/app/api/bets/[id]/confirm-result/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { confirmResult } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";
import { mockBet, mockConfirmation, makeReq, VALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "bet-1" }) };
const validBody = { decision: "CONFIRM_WINNER", claimedWinnerId: "u1" };

describe("POST /api/bets/[id]/confirm-result", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with bet + confirmation", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u2" });
    (confirmResult as ReturnType<typeof vi.fn>).mockResolvedValue({
      bet: mockBet({ status: "SETTLED", winnerId: "u1", resultStatus: "CONFIRMED" }),
      confirmation: mockConfirmation({
        userId: "u2",
        decision: "CONFIRM_WINNER",
        claimedWinnerId: "u1",
      }),
    });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/confirm-result", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bet.status).toBe("SETTLED");
    expect(json.bet.winnerId).toBe("u1");
    expect(json.confirmation.userId).toBe("u2");
    expect(json.confirmation.decision).toBe("CONFIRM_WINNER");
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/confirm-result", validBody),
      params,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. bad body → 400 (invalid decision enum)", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u2" });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/confirm-result", { decision: "MAYBE" }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("D. service BetError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u2" });
    (confirmResult as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BetError("BET_CONFIRM_BY_CLAIMANT", "cannot confirm own claim", 403),
    );

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/confirm-result", validBody),
      params,
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("BET_CONFIRM_BY_CLAIMANT");
    expect(json.message).toBe("cannot confirm own claim");
  });
});
