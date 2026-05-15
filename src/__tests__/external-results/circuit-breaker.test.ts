import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    externalProviderHealth: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { withCircuitBreaker, CircuitOpenError } from "@/lib/external-results/circuit-breaker";

const mockHealth = (
  overrides: Partial<{
    state: string;
    failureCount: number;
    successCount: number;
    totalRequests: number;
    cooldownUntil: Date | null;
  }> = {},
) => ({
  provider: "espn",
  state: "CLOSED",
  failureCount: 0,
  successCount: 0,
  totalRequests: 0,
  lastFailureAt: null,
  lastSuccessAt: null,
  cooldownUntil: null,
  updatedAt: new Date(),
  ...overrides,
});

describe("withCircuitBreaker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows call when CLOSED and tracks success", async () => {
    vi.mocked(prisma.externalProviderHealth.upsert).mockResolvedValue(mockHealth() as never);
    vi.mocked(prisma.externalProviderHealth.findUnique).mockResolvedValue(mockHealth() as never);
    vi.mocked(prisma.externalProviderHealth.update).mockResolvedValue(mockHealth() as never);

    const result = await withCircuitBreaker("espn", async () => "ok");
    expect(result).toBe("ok");
  });

  it("blocks call when OPEN and cooldown active", async () => {
    const future = new Date(Date.now() + 60_000);
    vi.mocked(prisma.externalProviderHealth.upsert).mockResolvedValue(
      mockHealth({ state: "OPEN", cooldownUntil: future }) as never,
    );

    await expect(withCircuitBreaker("espn", async () => "ok")).rejects.toThrow(CircuitOpenError);
  });

  it("transitions OPEN→HALF_OPEN when cooldown expired", async () => {
    const past = new Date(Date.now() - 1000);
    vi.mocked(prisma.externalProviderHealth.upsert).mockResolvedValue(
      mockHealth({ state: "OPEN", cooldownUntil: past }) as never,
    );
    vi.mocked(prisma.externalProviderHealth.findUnique).mockResolvedValue(
      mockHealth({ state: "HALF_OPEN" }) as never,
    );
    vi.mocked(prisma.externalProviderHealth.update).mockResolvedValue(mockHealth() as never);

    await withCircuitBreaker("espn", async () => "ok");

    expect(prisma.externalProviderHealth.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "HALF_OPEN" }),
      }),
    );
  });

  it("HALF_OPEN success transitions to CLOSED + resets counters", async () => {
    vi.mocked(prisma.externalProviderHealth.upsert).mockResolvedValue(
      mockHealth({ state: "HALF_OPEN" }) as never,
    );
    vi.mocked(prisma.externalProviderHealth.findUnique).mockResolvedValue(
      mockHealth({ state: "HALF_OPEN" }) as never,
    );
    vi.mocked(prisma.externalProviderHealth.update).mockResolvedValue(mockHealth() as never);

    await withCircuitBreaker("espn", async () => "ok");

    expect(prisma.externalProviderHealth.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "CLOSED",
          failureCount: 0,
          successCount: 0,
        }),
      }),
    );
  });

  it("HALF_OPEN failure transitions back to OPEN with new cooldown", async () => {
    vi.mocked(prisma.externalProviderHealth.upsert).mockResolvedValue(
      mockHealth({ state: "HALF_OPEN" }) as never,
    );
    vi.mocked(prisma.externalProviderHealth.findUnique).mockResolvedValue(
      mockHealth({ state: "HALF_OPEN" }) as never,
    );
    vi.mocked(prisma.externalProviderHealth.update).mockResolvedValue(mockHealth() as never);

    await expect(
      withCircuitBreaker("espn", async () => {
        throw new Error("provider failed");
      }),
    ).rejects.toThrow("provider failed");

    expect(prisma.externalProviderHealth.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "OPEN" }),
      }),
    );
  });

  it("opens circuit after 5 fails with >=50% rate", async () => {
    vi.mocked(prisma.externalProviderHealth.upsert).mockResolvedValue(mockHealth() as never);
    vi.mocked(prisma.externalProviderHealth.findUnique).mockResolvedValue(
      mockHealth({
        state: "CLOSED",
        failureCount: 4,
        totalRequests: 9,
      }) as never,
    );
    vi.mocked(prisma.externalProviderHealth.update).mockResolvedValue(mockHealth() as never);

    await expect(
      withCircuitBreaker("espn", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    const lastCall = vi.mocked(prisma.externalProviderHealth.update).mock.lastCall;
    expect(lastCall?.[0].data).toMatchObject({ state: "OPEN" });
  });
});
