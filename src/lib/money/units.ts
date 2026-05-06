/**
 * Canonical money type for zentrix.
 *
 * USDC has 6 decimals. We store all amounts as BigInt "units" where:
 *   1 USDC = 1_000_000n units
 *
 * Floats are FORBIDDEN in money paths (R4). The only place we convert to/from
 * a string display representation is in this file.
 */

export type Units = bigint;

/** USDC has 6 decimals on Solana. */
export const USDC_DECIMALS = 6;

/** 1 USDC expressed in units. */
export const ONE_USDC: Units = 10n ** BigInt(USDC_DECIMALS);

/**
 * Parse a USDC amount (as decimal string, e.g. "12.345678") to units.
 *
 * Throws if the input has more than 6 decimal places, contains non-numeric
 * characters, or is negative. Never accepts a number-typed argument — that
 * would re-introduce float drift.
 */
export function parseUsdc(decimalString: string): Units {
  if (typeof decimalString !== "string") {
    throw new TypeError("parseUsdc requires a string, never a number");
  }
  if (!/^-?\d+(\.\d{1,6})?$/.test(decimalString)) {
    throw new RangeError(`Invalid USDC decimal string: "${decimalString}"`);
  }
  const negative = decimalString.startsWith("-");
  const absolute = negative ? decimalString.slice(1) : decimalString;
  const [whole, frac = ""] = absolute.split(".");
  const padded = (frac + "000000").slice(0, USDC_DECIMALS);
  const units = BigInt(whole) * ONE_USDC + BigInt(padded);
  return negative ? -units : units;
}

/**
 * Format units back to a USDC display string with exactly 6 decimal places.
 * Used for UI rendering only — never for arithmetic.
 */
export function formatUsdc(units: Units): string {
  if (units < 0n) {
    return "-" + formatUsdc(-units);
  }
  const whole = units / ONE_USDC;
  const frac = units % ONE_USDC;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0");
  return `${whole}.${fracStr}`;
}

/**
 * Apply a basis-point fee to an amount.
 * 100 bps = 1%, 10000 bps = 100%.
 *
 * Uses BigInt division (truncates toward zero — accepted convention for fees,
 * with the dust going to the platform as documented in ADR).
 *
 * Throws on negative bps. Caller is responsible for ensuring bps <= 10000
 * if a percentage cap is required.
 */
export function applyBps(amount: Units, bps: number): Units {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new RangeError(`bps must be an integer in [0, 10000], got ${bps}`);
  }
  return (amount * BigInt(bps)) / 10000n;
}

/** Sum a list of unit amounts. Empty list returns 0n. */
export function sumUnits(amounts: readonly Units[]): Units {
  let total = 0n;
  for (const a of amounts) total += a;
  return total;
}

/**
 * Convert units to a number (lossy above 2^53 / ONE_USDC ≈ 9 billion USDC).
 * USE WITH CARE — only for charting/analytics, never for ledger math.
 */
export function unitsToNumber(units: Units): number {
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  if (units > MAX_SAFE || units < -MAX_SAFE) {
    throw new RangeError(`unitsToNumber: amount ${units} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(units);
}