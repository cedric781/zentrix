import { describe, it, expect } from "vitest";
import { parseUsdcAmountUnits, USDC_DECIMALS } from "./parse-transfer";

describe("parseUsdcAmountUnits", () => {
  it("prefers rawTokenAmount when present", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 3,
        rawTokenAmount: { tokenAmount: "3000000", decimals: 6 },
      }),
    ).toBe(3000000n);
  });

  it("falls back to tokenAmount when rawTokenAmount missing (Enhanced API GET)", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 3,
      }),
    ).toBe(3000000n);
  });

  it("handles fractional USDC precisely (Enhanced API GET fallback)", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 1.234567,
      }),
    ).toBe(1234567n);
  });

  it("rounds to 6 decimals when input has higher precision", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 1.2345678,
      }),
    ).toBe(1234568n);
  });

  it("returns null for zero amounts", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 0,
      }),
    ).toBeNull();
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 0,
        rawTokenAmount: { tokenAmount: "0", decimals: 6 },
      }),
    ).toBeNull();
  });

  it("returns null for negative amounts (defensive)", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: -1,
      }),
    ).toBeNull();
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: -1,
        rawTokenAmount: { tokenAmount: "-1000000", decimals: 6 },
      }),
    ).toBeNull();
  });

  it("returns null for NaN / Infinity / non-numbers", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: NaN,
      }),
    ).toBeNull();
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: Infinity,
      }),
    ).toBeNull();
  });

  it("returns null when rawTokenAmount has wrong decimals (token confusion attack)", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 3,
        rawTokenAmount: { tokenAmount: "3000000", decimals: 9 },
      }),
    ).toBeNull();
  });

  it("handles very small amount: 1 microUSDC", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 0.000001,
      }),
    ).toBe(1n);
  });

  it("handles large amount: 1,000,000 USDC", () => {
    expect(
      parseUsdcAmountUnits({
        mint: "x",
        fromUserAccount: "a",
        toUserAccount: "b",
        tokenAmount: 1_000_000,
      }),
    ).toBe(1_000_000_000_000n);
  });

  it("USDC_DECIMALS is 6", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
