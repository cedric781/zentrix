import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/disputes/service", () => ({
  openDispute: vi.fn(),
}));

import { POST } from "@/app/api/bets/[id]/disputes/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { openDispute } from "@/lib/disputes/service";
import { DisputeError } from "@/lib/disputes/errors";
import { mockDispute, makeReq, VALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "bet-1" }) };
const validBody = {
  reason: "Opponent claimed a winner without evidence",
};

describe("POST /api/bets/[id]/disputes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with dispute + depositUnits + ledgerTxId", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (openDispute as ReturnType<typeof vi.fn>).mockResolvedValue({
      dispute: mockDispute({ status: "OPEN", reason: validBody.reason }),
      depositUnits: 5000000n,
      ledgerTxId: "ltx-1",
    });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/disputes", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dispute.id).toBe("disp-1");
    expect(json.dispute.status).toBe("OPEN");
    expect(json.dispute.reason).toBe(validBody.reason);
    expect(json.depositUnits).toBe("5000000");
    expect(json.ledgerTxId).toBe("ltx-1");
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/disputes", validBody),
      params,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. bad body → 400 (reason too short)", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/disputes", { reason: "no" }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("D. service DisputeError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (openDispute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DisputeError("DISPUTE_ALREADY_OPEN", "already an open dispute", 409),
    );

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/disputes", validBody),
      params,
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("DISPUTE_ALREADY_OPEN");
    expect(json.message).toBe("already an open dispute");
  });
});
