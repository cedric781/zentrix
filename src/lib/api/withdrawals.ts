import { apiFetch } from "./client";

export type WithdrawalFeeResponse = {
  amountUsdc: string;
  feeUsdc: string;
  netUsdc: string;
};

export async function getWithdrawalFee(
  amountUsdc: string,
  options: { signal?: AbortSignal } = {},
): Promise<WithdrawalFeeResponse> {
  const qs = `?amountUsdc=${encodeURIComponent(amountUsdc)}`;
  return apiFetch<WithdrawalFeeResponse>(`/api/withdrawals/fee${qs}`, {
    method: "GET",
    signal: options.signal,
  });
}

export type CreateWithdrawalBody = {
  amountUsdc: string;  // decimal string e.g. "10.5"
  toAddress: string;   // Solana base58
};

export type CreateWithdrawalResponse = {
  id: string;
  status: "QUEUED";
  amountUsdc: string;  // BigInt string in micro-units
  feeUsdc: string;
  netUsdc: string;
};

/**
 * Submit withdrawal to backend.
 *
 * retryAttempts: 0 — financial POST must never auto-retry. A retried request
 * after a transient 5xx or network error could result in a duplicate debit
 * if the original request was actually processed server-side.
 *
 * Throws ApiError with WithdrawalErrorCode in error.code:
 *   WITHDRAWALS_DISABLED | INVALID_ADDRESS | INVALID_AMOUNT |
 *   AMOUNT_BELOW_MIN | INSUFFICIENT_BALANCE | EVM_ADDRESS_DETECTED |
 *   WALLET_NOT_DELEGATED | EXECUTOR_FAILED
 */
export async function createWithdrawal(
  body: CreateWithdrawalBody,
): Promise<CreateWithdrawalResponse> {
  return apiFetch<CreateWithdrawalResponse>("/api/withdrawals", {
    method: "POST",
    body,
    retryAttempts: 0,
  });
}
