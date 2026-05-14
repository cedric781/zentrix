import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/templates/service", () => ({
  listTemplates: vi.fn(),
}));

import { GET } from "@/app/api/templates/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { listTemplates } from "@/lib/templates/service";

function makeReq(url: string): Request {
  return new Request(url, { method: "GET" });
}

const T0 = new Date("2026-05-14T10:00:00.000Z");

function mockTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    slug: "football-match-winner",
    name: "Football Match Winner",
    category: "Sport",
    description: null,
    settlementType: "BINARY",
    settlementMethod: "PLATFORM_PROOF",
    outcomeType: "WINNER",
    fieldsSchema: { type: "object", properties: {} },
    allowedSources: [{ providerId: "official-api", name: "Official API", type: "OFFICIAL_API" }],
    resolutionRule: "Match winner per official source.",
    supportsAutoResolve: false,
    requiresOfficialEvent: true,
    isActive: true,
    version: 1,
    createdById: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

describe("GET /api/templates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with templates + total", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockTemplate(),
      mockTemplate({ id: "tpl-2", slug: "chess-match-winner", name: "Chess Match Winner", category: "Games" }),
    ]);

    const res = await GET(makeReq("http://x/api/templates"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
    expect(json.templates).toHaveLength(2);
    expect(json.templates[0].slug).toBe("football-match-winner");
  });

  it("B. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(new UnauthorizedError());

    const res = await GET(makeReq("http://x/api/templates"));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("C. category filter passes through to service", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockTemplate({ slug: "chess-match-winner", category: "Games" }),
    ]);

    const res = await GET(makeReq("http://x/api/templates?category=Games"));

    expect(res.status).toBe(200);
    expect(listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Games" }),
    );
  });

  it("D. invalid settlementMethod → 400 bad_query", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });

    const res = await GET(makeReq("http://x/api/templates?settlementMethod=BOGUS"));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("bad_query");
    expect(Array.isArray(json.issues)).toBe(true);
  });
});
