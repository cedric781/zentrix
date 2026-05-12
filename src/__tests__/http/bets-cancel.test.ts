import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/bets/service", () => ({
  cancelBet: vi.fn(),
}));

import { POST } from "@/app/api/bets/[id]/cancel/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { cancelBet } from "@/lib/bets/service";
import { BetError } from "@/lib/bets/errors";
import { mockBet, makeReq, VALID_UUID, INVALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "bet-1" }) };

describe("POST /api/bets/[id]/cancel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with cancelled bet", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (cancelBet as ReturnType<typeof vi.fn>).mockResolvedValue({
      bet: mockBet({ status: "CANCELLED", cancelledAt: new Date("2026-05-12T11:00:00Z") }),
    });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/cancel", {}, { "idempotency-key": VALID_UUID }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bet.id).toBe("bet-1");
    expect(json.bet.status).toBe("CANCELLED");
    expect(json.bet.cancelledAt).toBe("2026-05-12T11:00:00.000Z");
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(makeReq("http://x/api/bets/bet-1/cancel", {}), params);

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  // Note: cancel route has no body parsing, so the only 400 path is invalid idempotency-key.
  it("C. invalid idempotency-key → 400 INVALID_IDEMPOTENCY_KEY", async () => {
    const res = await POST(
      makeReq("http://x/api/bets/bet-1/cancel", {}, { "idempotency-key": INVALID_UUID }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("D. service BetError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (cancelBet as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BetError("BET_INVALID_STATUS", "bet not cancelable", 409),
    );

    const res = await POST(makeReq("http://x/api/bets/bet-1/cancel", {}), params);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("BET_INVALID_STATUS");
    expect(json.message).toBe("bet not cancelable");
  });
});
