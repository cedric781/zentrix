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
