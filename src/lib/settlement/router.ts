import type {
  ResolveBetInput,
  ResolveBetResult,
  SettlementMethod,
  SettlementMethodService,
} from "./types";
import { SettlementError } from "./types";
import { OfficialResultService } from "./methods/official-result";
import { OracleValueService } from "./methods/oracle-value";
import { PlatformProofService } from "./methods/platform-proof";
import { ThresholdMetricService } from "./methods/threshold-metric";

const services: Record<SettlementMethod, SettlementMethodService> = {
  OFFICIAL_RESULT: new OfficialResultService(),
  ORACLE_VALUE: new OracleValueService(),
  PLATFORM_PROOF: new PlatformProofService(),
  THRESHOLD_METRIC: new ThresholdMetricService(),
};

export function getSettlementService(method: SettlementMethod): SettlementMethodService {
  const service = services[method];
  if (!service) {
    throw new SettlementError(
      "SETTLEMENT_INVALID_METHOD",
      `Unknown settlement method: ${method}`,
      500,
    );
  }
  return service;
}

export async function resolveBet(input: ResolveBetInput): Promise<ResolveBetResult> {
  const service = getSettlementService(input.template.settlementMethod);
  service.validate(input);
  return service.resolve(input);
}
