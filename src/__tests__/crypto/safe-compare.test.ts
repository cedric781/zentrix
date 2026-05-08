import { describe, expect, it } from "vitest";
import { safeHashCompare } from "@/lib/crypto/safe-compare";

describe("safeHashCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeHashCompare("abc123", "abc123")).toBe(true);
  });
  it("returns false for different strings of same length", () => {
    expect(safeHashCompare("abc123", "abc124")).toBe(false);
  });
  it("returns false for different lengths without throwing", () => {
    expect(safeHashCompare("abc", "abc1")).toBe(false);
  });
});
