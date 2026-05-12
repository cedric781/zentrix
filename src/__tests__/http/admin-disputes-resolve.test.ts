import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {},
}));
vi.mock("@/lib/disputes/service", () => ({
  resolveDispute: vi.fn(),
}));

import { POST } from "@/app/api/admin/disputes/[id]/resolve/route";
import { requireAdmin } from "@/lib/admin";
import { resolveDispute } from "@/lib/disputes/service";
import { DisputeError } from "@/lib/disputes/errors";
import { mockBet, mockDispute, VALID_UUID } from "./_fixtures";

const makeReq = (body: unknown) =>
  new Request("http://x/api/admin/disputes/d1/resolve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": VALID_UUID,
    },
    body: JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/admin/disputes/[id]/resolve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path → 200 with data:serializedDispute (RESOLVED)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (resolveDispute as ReturnType<typeof vi.fn>).mockResolvedValue({
      dispute: mockDispute({
        id: "d1",
        status: "RESOLVED",
        outcome: "CREATOR_WINS",
      }),
      bet: mockBet({ id: "b1" }),
      ledgerTxIds: ["lx1"],
    });
    const res = await POST(
      makeReq({
        outcome: "CREATOR_WINS",
        reasoning: "Evidence shows creator side won.",
        actorAdminId: "admin-rapha",
      }),
      ctx("d1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe("d1");
    expect(json.data.status).toBe("RESOLVED");
    expect(json.data.outcome).toBe("CREATOR_WINS");
    expect(resolveDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: "d1",
        adminId: "admin-rapha",
        outcome: "CREATOR_WINS",
        adminNotes: "Evidence shows creator side won.",
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
        outcome: "CREATOR_WINS",
        reasoning: "test reasoning over 10 chars",
        actorAdminId: "admin-rapha",
      }),
      ctx("d1"),
    );
    expect(res.status).toBe(401);
  });

  it("bad body (invalid outcome) → 400", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const res = await POST(
      makeReq({
        outcome: "INVALID",
        reasoning: "valid reasoning text",
        actorAdminId: "admin-rapha",
      }),
      ctx("d1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("domain error mapped (DISPUTE_NOT_FOUND → 404)", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (resolveDispute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DisputeError("DISPUTE_NOT_FOUND", "Dispute not found", 404),
    );
    const res = await POST(
      makeReq({
        outcome: "VOID",
        reasoning: "neither side provided sufficient evidence",
        actorAdminId: "admin-rapha",
      }),
      ctx("d1"),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("DISPUTE_NOT_FOUND");
  });
});
