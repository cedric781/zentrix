import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/matches/service", () => ({
  submitMatchResult: vi.fn(),
}));

import { POST } from "@/app/api/matches/[id]/result/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { submitMatchResult } from "@/lib/matches/service";
import { MatchError } from "@/lib/matches/errors";
import { mockMatch, makeReq, VALID_UUID } from "./_fixtures";

const params = { params: Promise.resolve({ id: "match-1" }) };
const validBody = {
  winnerSide: "A",
  evidence: [
    {
      type: "IMAGE",
      fileUrl: "https://example.com/result.png",
      mimeType: "image/png",
      contentHash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  ],
};

describe("POST /api/matches/[id]/result", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with match + evidenceCount", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (submitMatchResult as ReturnType<typeof vi.fn>).mockResolvedValue({
      match: mockMatch({ status: "RESULT_SUBMITTED", winnerSide: "A" }),
      evidenceCount: 1,
    });

    const res = await POST(
      makeReq("http://x/api/matches/match-1/result", validBody, {
        "idempotency-key": VALID_UUID,
      }),
      params,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.match.id).toBe("match-1");
    expect(json.match.status).toBe("RESULT_SUBMITTED");
    expect(json.match.winnerSide).toBe("A");
    expect(json.evidenceCount).toBe(1);
    expect(res.headers.get("idempotency-key")).toBe(VALID_UUID);
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnauthorizedError(),
    );

    const res = await POST(
      makeReq("http://x/api/matches/match-1/result", validBody),
      params,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. bad body → 400 (invalid winnerSide)", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await POST(
      makeReq("http://x/api/matches/match-1/result", { winnerSide: "C" }),
      params,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
  });

  it("D. service MatchError → mapped status & code", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (submitMatchResult as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MatchError(
        "MATCH_RESULT_ALREADY_SUBMITTED",
        "result already submitted",
        409,
      ),
    );

    const res = await POST(
      makeReq("http://x/api/matches/match-1/result", validBody),
      params,
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("MATCH_RESULT_ALREADY_SUBMITTED");
    expect(json.message).toBe("result already submitted");
  });
});
