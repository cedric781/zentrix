import { prisma } from "@/lib/prisma";
import type { SupportedProvider } from "@/lib/api/types";

const FAILURE_THRESHOLD_COUNT = 5;
const FAILURE_THRESHOLD_RATE = 0.5;
const MIN_REQUESTS_FOR_RATE = 10;
const COOLDOWN_MS = 5 * 60 * 1000;

export class CircuitOpenError extends Error {
  constructor(
    public readonly provider: SupportedProvider,
    public readonly cooldownUntil: Date,
  ) {
    super(`Circuit OPEN for ${provider} until ${cooldownUntil.toISOString()}`);
    this.name = "CircuitOpenError";
  }
}

export async function withCircuitBreaker<T>(
  provider: SupportedProvider,
  fn: () => Promise<T>,
): Promise<T> {
  const health = await getOrCreateHealth(provider);
  const now = new Date();

  if (health.state === "OPEN") {
    if (health.cooldownUntil && health.cooldownUntil > now) {
      throw new CircuitOpenError(provider, health.cooldownUntil);
    }
    await prisma.externalProviderHealth.update({
      where: { provider },
      data: { state: "HALF_OPEN" },
    });
  }

  try {
    const result = await fn();
    await recordSuccess(provider);
    return result;
  } catch (err) {
    await recordFailure(provider);
    throw err;
  }
}

async function getOrCreateHealth(provider: SupportedProvider) {
  return prisma.externalProviderHealth.upsert({
    where: { provider },
    create: { provider, state: "CLOSED" },
    update: {},
  });
}

async function recordSuccess(provider: SupportedProvider): Promise<void> {
  const current = await prisma.externalProviderHealth.findUnique({ where: { provider } });
  if (!current) return;

  if (current.state === "HALF_OPEN") {
    await prisma.externalProviderHealth.update({
      where: { provider },
      data: {
        state: "CLOSED",
        failureCount: 0,
        successCount: 0,
        totalRequests: 0,
        lastSuccessAt: new Date(),
        cooldownUntil: null,
      },
    });
    return;
  }

  await prisma.externalProviderHealth.update({
    where: { provider },
    data: {
      successCount: { increment: 1 },
      totalRequests: { increment: 1 },
      lastSuccessAt: new Date(),
    },
  });
}

async function recordFailure(provider: SupportedProvider): Promise<void> {
  const current = await prisma.externalProviderHealth.findUnique({ where: { provider } });
  if (!current) return;

  const newFailureCount = current.failureCount + 1;
  const newTotalRequests = current.totalRequests + 1;
  const failureRate =
    newTotalRequests >= MIN_REQUESTS_FOR_RATE ? newFailureCount / newTotalRequests : 0;

  const shouldOpen =
    newFailureCount >= FAILURE_THRESHOLD_COUNT && failureRate >= FAILURE_THRESHOLD_RATE;

  if (current.state === "HALF_OPEN") {
    await prisma.externalProviderHealth.update({
      where: { provider },
      data: {
        state: "OPEN",
        failureCount: newFailureCount,
        totalRequests: newTotalRequests,
        lastFailureAt: new Date(),
        cooldownUntil: new Date(Date.now() + COOLDOWN_MS),
      },
    });
    return;
  }

  await prisma.externalProviderHealth.update({
    where: { provider },
    data: {
      state: shouldOpen ? "OPEN" : current.state,
      failureCount: newFailureCount,
      totalRequests: newTotalRequests,
      lastFailureAt: new Date(),
      ...(shouldOpen ? { cooldownUntil: new Date(Date.now() + COOLDOWN_MS) } : {}),
    },
  });
}

export async function resetCircuitBreaker(provider: SupportedProvider): Promise<void> {
  await prisma.externalProviderHealth.update({
    where: { provider },
    data: {
      state: "CLOSED",
      failureCount: 0,
      successCount: 0,
      totalRequests: 0,
      cooldownUntil: null,
    },
  });
}
