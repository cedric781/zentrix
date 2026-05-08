import { describe, test, expect } from "vitest";
import { FEES } from "@/lib/fees";

describe("FEES constants (ADR-0003)", () => {
  test("bps and USDC-unit values match ADR-0003 spec", () => {
    expect(FEES.PLATFORM_BPS).toBe(200);
    expect(FEES.DISPUTE_RESOLUTION_BPS).toBe(1500);
    expect(FEES.DISPUTE_DEPOSIT_BPS).toBe(1000);
    expect(FEES.WITHDRAWAL_BPS).toBe(100);
    expect(FEES.DISPUTE_DEPOSIT_MIN_USDC_UNITS).toBe(500_000n);
    expect(FEES.WITHDRAWAL_MIN_USDC_UNITS).toBe(100_000n);
    expect(FEES.WITHDRAWAL_MAX_USDC_UNITS).toBe(5_000_000n);
  });
});
