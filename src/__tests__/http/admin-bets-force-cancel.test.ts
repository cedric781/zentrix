import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/disputes/service", () => ({
  forceCancelBet: vi.fn(),
}));

import { POST } from "@/app/api/admin/bets/[id]/force-cancel/route";
import { requireAdmin } from "@/lib/admin";
import { forceCancelBet } from "@/lib/disputes/service";
import { BetError } from "@/lib/bets/errors";
import { mockBet, VALID_UUID } from "./_fixtures";

const FAKE_ADMIN_ID = "00000000-0000-4000-8000-000000000001";

const makeReq = (body: unknown) =>
  new Request("http://x/api/admin/bets/b1/force-cancel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": VALID_UUID,
    },
    body: JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/admin/bets/[id]/force-cancel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with data:serializedBet (CANCELLED)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (forceCancelBet as ReturnType<typeof vi.fn>).mockResolvedValue({
      bet: mockBet({ id: "b1", status: "CANCELLED" }),
      ledgerTxId: "lx1",
    });
    const res = await POST(
      makeReq({
        reason: "Bet contains illegal terms per platform policy.",
        actorAdminId: FAKE_ADMIN_ID,
      }),
      ctx("b1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("b1");
    expect(json.data.status).toBe("CANCELLED");
    expect(forceCancelBet).toHaveBeenCalledWith(
      expect.objectContaining({
        betId: "b1",
        adminId: FAKE_ADMIN_ID,
        reason: "Bet contains illegal terms per platform policy.",
      }),
    );
  });

  it("admin auth fail → 401", async () => {
    const { AdminAuthError } = await import("@/lib/admin");
    (requireAdmin as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AdminAuthError(),
    );
    const res = await POST(
      makeReq({
        reason: "valid reason over 10 chars",
        actorAdminId: FAKE_ADMIN_ID,
      }),
      ctx("b1"),
    );
    expect(res.status).toBe(401);
  });

  it("bad body (reason too short) → 400", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const res = await POST(
      makeReq({ reason: "short", actorAdminId: FAKE_ADMIN_ID }),
      ctx("b1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("domain error mapped (BET_INVALID_STATUS → 409)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (forceCancelBet as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BetError("BET_INVALID_STATUS", "Bet already settled", 409),
    );
    const res = await POST(
      makeReq({
        reason: "Bet was already settled, can't be cancelled.",
        actorAdminId: FAKE_ADMIN_ID,
      }),
      ctx("b1"),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("BET_INVALID_STATUS");
  });

  it("malformed actorAdminId → 400", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const res = await POST(
      makeReq({
        reason: "valid reason over 10 chars",
        actorAdminId: "not-a-uuid",
      }),
      ctx("b1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });
});
