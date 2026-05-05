import { describe, expect, it, beforeEach, vi } from "vitest";
import { _resetEnvCache, getEnv } from "@/lib/env";

describe("env loader", () => {
  beforeEach(() => {
    _resetEnvCache();
    vi.unstubAllEnvs();
  });

  it("parses NODE_ENV from process.env", () => {
    vi.stubEnv("NODE_ENV", "test");
    const env = getEnv();
    expect(env.NODE_ENV).toBe("test");
  });

  it("defaults DEPOSITS_DISABLED and WITHDRAWALS_DISABLED to false", () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.DEPOSITS_DISABLED;
    delete process.env.WITHDRAWALS_DISABLED;
    const env = getEnv();
    expect(env.DEPOSITS_DISABLED).toBe(false);
    expect(env.WITHDRAWALS_DISABLED).toBe(false);
  });
});