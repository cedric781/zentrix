import "server-only";
import type { CircuitBreaker } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Per-feature operational kill switches, distinct from the R8 hardcoded
 * fallback (which is a code-deploy lever for env-store outages). These
 * are the day-to-day operator levers — flip via /api/admin/breakers.
 *
 * `isCircuitOpen` is cached for 5 seconds in-memory per process.
 * Operators flipping a breaker need to wait up to 5 sec for serverless
 * instances to pick up the change — acceptable for ops actions that
 * are rare. For an instant kill, use the env `WITHDRAWALS_DISABLED`
 * toggle (R8) which is checked separately.
 */
const cache = new Map<string, { isOpen: boolean; expiresAt: number }>();
const TTL_MS = 5_000;

export async function isCircuitOpen(key: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.isOpen;

  const cb = await prisma.circuitBreaker.findUnique({ where: { key } });
  const isOpen = cb?.isOpen ?? false;
  cache.set(key, { isOpen, expiresAt: now + TTL_MS });
  return isOpen;
}

export async function tripCircuit(
  key: string,
  reason: string,
  openedBy: string = "system",
): Promise<void> {
  await prisma.circuitBreaker.update({
    where: { key },
    data: {
      isOpen: true,
      reason,
      openedAt: new Date(),
      openedBy,
      tripCount: { increment: 1 },
      lastTripAt: new Date(),
    },
  });
  cache.delete(key);
  logger.warn({ key, reason, openedBy }, "circuit breaker tripped");
}

export async function resetCircuit(
  key: string,
  closedBy: string = "system",
): Promise<void> {
  await prisma.circuitBreaker.update({
    where: { key },
    data: { isOpen: false, closedAt: new Date(), reason: null },
  });
  cache.delete(key);
  logger.info({ key, closedBy }, "circuit breaker closed");
}

export async function listCircuits(): Promise<CircuitBreaker[]> {
  return prisma.circuitBreaker.findMany({ orderBy: { key: "asc" } });
}

/** Reset cache (test only). */
export function _resetCircuitBreakerCache() {
  cache.clear();
}
