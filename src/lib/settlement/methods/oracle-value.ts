import type {
  ResolveBetInput,
  ResolveBetResult,
  SettlementMethodService,
} from "../types";
import { SettlementError } from "../types";

export class OracleValueService implements SettlementMethodService {
  readonly method = "ORACLE_VALUE" as const;

  validate(_input: ResolveBetInput): void {
    throw new SettlementError(
      "SETTLEMENT_NOT_IMPLEMENTED",
      "ORACLE_VALUE not yet implemented",
      501,
    );
  }

  async resolve(_input: ResolveBetInput): Promise<ResolveBetResult> {
    throw new SettlementError(
      "SETTLEMENT_NOT_IMPLEMENTED",
      "ORACLE_VALUE not yet implemented",
      501,
    );
  }
}
