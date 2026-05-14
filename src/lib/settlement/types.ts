export type SettlementMethod =
  | "OFFICIAL_RESULT"
  | "ORACLE_VALUE"
  | "PLATFORM_PROOF"
  | "THRESHOLD_METRIC";

export type ResolveBetInput = {
  betId: string;
  template: { slug: string; settlementMethod: SettlementMethod; allowedSources: unknown };
  proof: unknown;
  initiatorUserId: string;
};

export type ResolveBetResult = {
  winnerSide: "A" | "B" | "VOID";
  resolvedAt: Date;
  evidence: unknown;
  method: SettlementMethod;
};

export interface SettlementMethodService {
  readonly method: SettlementMethod;
  validate(input: ResolveBetInput): void;
  resolve(input: ResolveBetInput): Promise<ResolveBetResult>;
}

export class SettlementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "SettlementError";
  }
}
