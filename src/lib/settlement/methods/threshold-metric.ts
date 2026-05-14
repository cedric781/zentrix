import type {
  ResolveBetInput,
  ResolveBetResult,
  SettlementMethodService,
} from "../types";
import { SettlementError } from "../types";

export class ThresholdMetricService implements SettlementMethodService {
  readonly method = "THRESHOLD_METRIC" as const;

  validate(_input: ResolveBetInput): void {
    throw new SettlementError(
      "SETTLEMENT_NOT_IMPLEMENTED",
      "THRESHOLD_METRIC not yet implemented",
      501,
    );
  }

  async resolve(_input: ResolveBetInput): Promise<ResolveBetResult> {
    throw new SettlementError(
      "SETTLEMENT_NOT_IMPLEMENTED",
      "THRESHOLD_METRIC not yet implemented",
      501,
    );
  }
}
