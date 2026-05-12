import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/disputes/service", () => ({
  submitDisputeEvidence: vi.fn(),
}));

import { POST } from "@/app/api/disputes/[id]/evidence/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { submitDisputeEvidence } from "@/lib/disputes/service";
import { DisputeError } from "@/lib/disputes/errors";
import { mockDispute, makeReq, VALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "disp-1" }) };
const validBody = {
  items: [
    {
      type: "URL",
      fileUrl: "https://example.com/proof.png",
      contentHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      description: "screenshot",
    },
  ],
};

describe("POST /api/disputes/[id]/evidence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with dispute + counts", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (submitDisputeEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      dispute: mockDispute({ status: "EVIDENCE_PHASE" }),
      evidenceAdded: 1,
      evidenceTotal: 3,
    });

    const res = await POST(
      makeReq("http://x/api/disputes/disp-1/evidence", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dispute.id).toBe("disp-1");
    expect(json.dispute.status).toBe("EVIDENCE_PHASE");
    expect(json.evidenceAdded).toBe(1);
    expect(json.evidenceTotal).toBe(3);
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(
      makeReq("http://x/api/disputes/disp-1/evidence", validBody),
      params,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. bad body → 400 (empty items array)", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await POST(
      makeReq("http://x/api/disputes/disp-1/evidence", { items: [] }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("D. service DisputeError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (submitDisputeEvidence as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DisputeError(
        "DISPUTE_INVALID_STATUS",
        "dispute not eligible for evidence",
        409,
      ),
    );

    const res = await POST(
      makeReq("http://x/api/disputes/disp-1/evidence", validBody),
      params,
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("DISPUTE_INVALID_STATUS");
    expect(json.message).toBe("dispute not eligible for evidence");
  });
});
