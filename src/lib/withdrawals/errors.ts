export class WithdrawalError extends Error {
  constructor(
    public code: WithdrawalErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "WithdrawalError";
  }
}

export type WithdrawalErrorCode =
  | "WITHDRAWALS_DISABLED"
  | "INVALID_ADDRESS"
  | "INVALID_AMOUNT"
  | "AMOUNT_BELOW_MIN"
  | "INSUFFICIENT_BALANCE"
  | "EVM_ADDRESS_DETECTED"
  | "WALLET_NOT_DELEGATED"
  | "EXECUTOR_FAILED";
