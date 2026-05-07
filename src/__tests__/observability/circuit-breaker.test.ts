import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  isCircuitOpen,
  tripCircuit,
  resetCircuit,
  listCircuits,
  _resetCircuitBreakerCache,
} from "@/lib/circuit-breaker";

const TEST_KEY = "test-cb-key";

describe("circuit-breaker", () => {
  beforeEach(async () => {
    _resetCircuitBreakerCache();
    await prisma.circuitBreaker.upsert({
      where: { key: TEST_KEY },
      create: { key: TEST_KEY, isOpen: false },
      update: {
        isOpen: false,
        reason: null,
        openedAt: null,
        openedBy: null,
        closedAt: null,
        tripCount: 0,
        lastTripAt: null,
      },
    });
  });

  afterAll(async () => {
    // Drop test-only breakers (anything we created) so the schema-smoke test
    // and intake's withdrawal-breaker check stay deterministic.
    await prisma.circuitBreaker.deleteMany({ where: { key: { startsWith: "test-" } } });
    // Defensive: reset the 3 seeded breakers to closed state — if a test
    // triggered tripCircuit on a real key (it shouldn't), this restores.
    await prisma.circuitBreaker.updateMany({
      where: { key: { in: ["deposits", "withdrawals", "settlement"] } },
      data: {
        isOpen: false,
        reason: null,
        openedAt: null,
        openedBy: null,
        closedAt: null,
        tripCount: 0,
        lastTripAt: null,
      },
    });
    _resetCircuitBreakerCache();
    await prisma.$disconnect();
  });

  it("isCircuitOpen returns false for a freshly-created closed breaker", async () => {
    expect(await isCircuitOpen(TEST_KEY)).toBe(false);
  });

  it("tripCircuit opens the breaker, records reason + openedBy + lastTripAt", async () => {
    await tripCircuit(TEST_KEY, "investigating spike", "tester");
    _resetCircuitBreakerCache();
    expect(await isCircuitOpen(TEST_KEY)).toBe(true);

    const cb = await prisma.circuitBreaker.findUnique({ where: { key: TEST_KEY } });
    expect(cb?.isOpen).toBe(true);
    expect(cb?.reason).toBe("investigating spike");
    expect(cb?.openedBy).toBe("tester");
    expect(cb?.openedAt).not.toBeNull();
    expect(cb?.lastTripAt).not.toBeNull();
  });

  it("resetCircuit closes the breaker and clears reason", async () => {
    await tripCircuit(TEST_KEY, "x", "tester");
    await resetCircuit(TEST_KEY, "tester");
    _resetCircuitBreakerCache();
    expect(await isCircuitOpen(TEST_KEY)).toBe(false);

    const cb = await prisma.circuitBreaker.findUnique({ where: { key: TEST_KEY } });
    expect(cb?.isOpen).toBe(false);
    expect(cb?.reason).toBeNull();
    expect(cb?.closedAt).not.toBeNull();
  });

  it("tripCount increments on each trip, even after reset", async () => {
    await tripCircuit(TEST_KEY, "first", "tester");
    await resetCircuit(TEST_KEY, "tester");
    await tripCircuit(TEST_KEY, "second", "tester");
    const cb = await prisma.circuitBreaker.findUnique({ where: { key: TEST_KEY } });
    expect(cb?.tripCount).toBe(2);
  });

  it("isCircuitOpen caches state until _resetCircuitBreakerCache is called", async () => {
    // Prime the cache with the closed state.
    expect(await isCircuitOpen(TEST_KEY)).toBe(false);

    // Sneak past the helper to mutate DB without invalidating cache.
    await prisma.circuitBreaker.update({
      where: { key: TEST_KEY },
      data: { isOpen: true },
    });

    // Still false — cache hit, DB ignored.
    expect(await isCircuitOpen(TEST_KEY)).toBe(false);

    // After clearing the cache, the DB value wins.
    _resetCircuitBreakerCache();
    expect(await isCircuitOpen(TEST_KEY)).toBe(true);
  });

  it("listCircuits returns all 3 seeded breakers", async () => {
    const breakers = await listCircuits();
    const keys = breakers.map((b) => b.key);
    expect(keys).toContain("deposits");
    expect(keys).toContain("withdrawals");
    expect(keys).toContain("settlement");
  });
});
