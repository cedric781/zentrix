import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/templates/service", () => ({
  getTemplate: vi.fn(),
}));

import { GET } from "@/app/api/templates/[slug]/route";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { getTemplate } from "@/lib/templates/service";

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

describe("GET /api/templates/[slug]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("A. happy path → 200 with template", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (getTemplate as ReturnType<typeof vi.fn>).mockResolvedValue(mockTemplate());

    const res = await GET(makeReq("http://x/api/templates/football-match-winner"), {
      params: Promise.resolve({ slug: "football-match-winner" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.template.slug).toBe("football-match-winner");
    expect(json.template.name).toBe("Football Match Winner");
  });

  it("B. not found → 404 template_not_found", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (getTemplate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET(makeReq("http://x/api/templates/no-such-slug"), {
      params: Promise.resolve({ slug: "no-such-slug" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("template_not_found");
    expect(json.slug).toBe("no-such-slug");
  });

  it("C. unauthorized → 401", async () => {
    (requireCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(new UnauthorizedError());

    const res = await GET(makeReq("http://x/api/templates/anything"), {
      params: Promise.resolve({ slug: "anything" }),
    });

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });
});
