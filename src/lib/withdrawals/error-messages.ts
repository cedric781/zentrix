/**
 * User-facing messages for backend WithdrawalErrorCode values.
 * Backend codes ARE the contract — frontend translates to UX text.
 */
export const WITHDRAWAL_ERROR_MESSAGES: Record<string, string> = {
  WITHDRAWALS_DISABLED:
    "Withdrawals are temporarily disabled. Please try again later.",
  INVALID_ADDRESS:
    "That doesn't look like a valid Solana address. Double-check and try again.",
  INVALID_AMOUNT:
    "Amount must be a positive number (e.g. 10.5).",
  AMOUNT_BELOW_MIN:
    "Amount is below the minimum withdrawal threshold.",
  INSUFFICIENT_BALANCE:
    "Your balance is too low for this withdrawal (including fees).",
  EVM_ADDRESS_DETECTED:
    "That looks like an Ethereum address. Zentrix uses Solana — withdrawals to EVM chains would be lost.",
  WALLET_NOT_DELEGATED:
    "Your wallet isn't ready yet. Try signing out and back in.",
  EXECUTOR_FAILED:
    "Withdrawal couldn't be sent due to a network issue. Your balance is unchanged. Please try again.",
};

export function getWithdrawalErrorMessage(code: string | undefined): string {
  if (!code) return "Something went wrong. Please try again.";
  return WITHDRAWAL_ERROR_MESSAGES[code] ?? `Withdrawal failed (${code}).`;
}
