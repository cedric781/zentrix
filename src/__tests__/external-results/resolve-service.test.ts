import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeNextRetryAt } from "@/lib/external-results/resolve-service";

describe("computeNextRetryAt — exponential backoff", () => {
  const FROZEN_NOW = new Date("2026-05-24T18:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retryCount=0 returns now + 1 minute", () => {
    const result = computeNextRetryAt(0);
    expect(result.getTime()).toBe(FROZEN_NOW + 60_000);
  });

  it("retryCount=1 returns now + 2 minutes", () => {
    const result = computeNextRetryAt(1);
    expect(result.getTime()).toBe(FROZEN_NOW + 2 * 60_000);
  });

  it("retryCount=3 returns now + 8 minutes", () => {
    const result = computeNextRetryAt(3);
    expect(result.getTime()).toBe(FROZEN_NOW + 8 * 60_000);
  });

  it("retryCount=4 returns now + 16 minutes", () => {
    const result = computeNextRetryAt(4);
    expect(result.getTime()).toBe(FROZEN_NOW + 16 * 60_000);
  });

  it("retryCount=6 caps at 1 hour (64 min would exceed)", () => {
    const result = computeNextRetryAt(6);
    expect(result.getTime()).toBe(FROZEN_NOW + 60 * 60_000);
  });

  it("retryCount=20 still caps at 1 hour (no overflow)", () => {
    const result = computeNextRetryAt(20);
    expect(result.getTime()).toBe(FROZEN_NOW + 60 * 60_000);
  });

  it("returns Date instance (not number)", () => {
    expect(computeNextRetryAt(0)).toBeInstanceOf(Date);
  });
});
