import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bet: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/settlement/router", () => ({
  resolveBet: vi.fn(),
}));

import { POST } from "@/app/api/bets/[id]/resolve/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBet } from "@/lib/settlement/router";
import { mockBet, makeReq, VALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "bet-1" }) };
const validBody = {
  method: "PLATFORM_PROOF",
  proof: { winnerSide: "A" },
};

describe("POST /api/bets/[id]/resolve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path PLATFORM_PROOF → 200 with decision", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (prisma.bet.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockBet({ createdById: "u1", opponentUserId: "u2" }),
    );
    (resolveBet as ReturnType<typeof vi.fn>).mockResolvedValue({
      winnerSide: "A",
      resolvedAt: new Date("2026-05-14T10:00:00.000Z"),
      evidence: { type: "platform_proof", initiatorUserId: "u1" },
      method: "PLATFORM_PROOF",
    });

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/resolve", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.decision.winnerSide).toBe("A");
    expect(json.decision.method).toBe("PLATFORM_PROOF");
    expect(json.decision.resolvedAt).toBe("2026-05-14T10:00:00.000Z");
    expect(typeof json.note).toBe("string");
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(new UnauthorizedError());

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/resolve", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. not participant → 403 BET_NOT_PARTICIPANT", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "outsider" });
    (prisma.bet.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockBet({ createdById: "u1", opponentUserId: "u2" }),
    );

    const res = await POST(
      makeReq("http://x/api/bets/bet-1/resolve", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("BET_NOT_PARTICIPANT");
  });

  it("D. invalid Idempotency-Key (non-UUID) → 400", async () => {
    const res = await POST(
      makeReq("http://x/api/bets/bet-1/resolve", validBody, {
        "idempotency-key": "not-a-uuid",
      }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_IDEMPOTENCY_KEY");
  });
});
