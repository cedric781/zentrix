import "server-only";
import type { HeliusTokenTransfer } from "@/lib/solana/helius-types";

export const USDC_DECIMALS = 6;

/**
 * Convert Helius tokenTransfer to raw bigint units.
 *
 * Prefers rawTokenAmount.tokenAmount (string) when present (webhook path).
 * Falls back to tokenAmount (number) for Enhanced API GET endpoint which
 * empirically omits rawTokenAmount.
 *
 * Returns null = caller MUST skip with logIndex++; logger.warn.
 */
export function parseUsdcAmountUnits(
  tt: HeliusTokenTransfer,
): bigint | null {
  if (tt.rawTokenAmount) {
    if (tt.rawTokenAmount.decimals !== USDC_DECIMALS) {
      return null;
    }
    let units: bigint;
    try {
      units = BigInt(tt.rawTokenAmount.tokenAmount);
    } catch {
      return null;
    }
    if (units <= 0n) return null;
    return units;
  }

  const display = tt.tokenAmount;
  if (typeof display !== "number" || !Number.isFinite(display)) return null;
  if (display <= 0) return null;

  // Precision-safe: convert via toFixed(decimals) → strip dot → BigInt.
  // toFixed guarantees exactly USDC_DECIMALS fractional digits with banker's
  // rounding, so 0.000001 → "0.000001" → "0000001" → 1n.
  const fixed = display.toFixed(USDC_DECIMALS);
  const dotIndex = fixed.indexOf(".");
  const digitsOnly =
    dotIndex === -1
      ? fixed + "0".repeat(USDC_DECIMALS)
      : fixed.slice(0, dotIndex) + fixed.slice(dotIndex + 1);

  let units: bigint;
  try {
    units = BigInt(digitsOnly);
  } catch {
    return null;
  }
  if (units <= 0n) return null;
  return units;
}
