import { applyBps, parseUsdc } from "@/lib/money/units";
import { getEnv } from "@/lib/env";

/**
 * Withdrawal fee: WITHDRAWAL_FEE_BPS basis points of amount, clamped to
 * [WITHDRAWAL_FEE_MIN_USDC, WITHDRAWAL_FEE_MAX_USDC].
 *
 * Example: 50 bps = 0.5%. On a 100 USDC withdrawal, fee = 0.5 USDC.
 * On a 0.1 USDC withdrawal (which would compute to 0.0005 USDC),
 * the floor of 0.5 USDC applies — meaning users can't economically
 * withdraw less than the minimum.
 */
export function calculateWithdrawalFee(amountUnits: bigint): bigint {
  const env = getEnv();
  const raw = applyBps(amountUnits, env.WITHDRAWAL_FEE_BPS);
  const min = parseUsdc(env.WITHDRAWAL_FEE_MIN_USDC);
  const max = parseUsdc(env.WITHDRAWAL_FEE_MAX_USDC);
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}
