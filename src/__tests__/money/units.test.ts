import { describe, expect, it } from "vitest";
import { parseUsdc, formatUsdc, applyBps, ONE_USDC } from "@/lib/money/units";

describe("parseUsdc", () => {
  it("parses whole numbers", () => expect(parseUsdc("5")).toBe(5_000_000n));
  it("parses 6-decimal max", () => expect(parseUsdc("1.234567")).toBe(1_234_567n));
  it("preserves trailing zeros", () => expect(parseUsdc("1.500000")).toBe(1_500_000n));
  it("rejects 7+ decimals", () => expect(() => parseUsdc("1.1234567")).toThrow(RangeError));
  it("rejects scientific notation", () => expect(() => parseUsdc("1e6")).toThrow(RangeError));
  it("rejects empty string", () => expect(() => parseUsdc("")).toThrow(RangeError));
  it("rejects non-string", () => expect(() => parseUsdc(5 as unknown as string)).toThrow(TypeError));
  it("handles negative", () => expect(parseUsdc("-2.5")).toBe(-2_500_000n));
});

describe("formatUsdc", () => {
  it("formats positive", () => expect(formatUsdc(1_234_567n)).toBe("1.234567"));
  it("formats zero", () => expect(formatUsdc(0n)).toBe("0.000000"));
  it("formats negative", () => expect(formatUsdc(-2_500_000n)).toBe("-2.500000"));
  it("round trips", () => {
    const inputs = ["0", "1", "1.5", "12345.678901", "-7.123"];
    for (const i of inputs) expect(formatUsdc(parseUsdc(i))).toBe(i.includes(".") ? i.padEnd(i.indexOf(".") + 7, "0") : `${i}.000000`);
  });
});

describe("applyBps", () => {
  it("250 bps of 100 USDC = 2.5 USDC", () => {
    expect(applyBps(100n * ONE_USDC, 250)).toBe(2_500_000n);
  });
  it("floors small fractions", () => {
    // 33 bps of 1 USDC = 0.0033 USDC = 3300 micro-units
    expect(applyBps(ONE_USDC, 33)).toBe(3300n);
  });
  it("rejects fractional bps", () => expect(() => applyBps(100n, 1.5)).toThrow(RangeError));
  it("rejects negative bps", () => expect(() => applyBps(100n, -1)).toThrow(RangeError));
  it("rejects bps > 10000", () => expect(() => applyBps(100n, 10_001)).toThrow(RangeError));
});
