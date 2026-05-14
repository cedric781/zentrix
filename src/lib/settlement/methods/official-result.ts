import type {
  ResolveBetInput,
  ResolveBetResult,
  SettlementMethodService,
} from "../types";
import { SettlementError } from "../types";

export class OfficialResultService implements SettlementMethodService {
  readonly method = "OFFICIAL_RESULT" as const;

  validate(input: ResolveBetInput): void {
    if (!input.proof) {
      throw new SettlementError(
        "SETTLEMENT_INVALID_PROOF",
        "Proof required for OFFICIAL_RESULT",
        400,
      );
    }
    const proof = input.proof as { sourceUrl?: string; resultData?: unknown };
    if (!proof.sourceUrl) {
      throw new SettlementError("SETTLEMENT_INVALID_PROOF", "sourceUrl required", 400);
    }

    const allowedSources = input.template.allowedSources as Array<{ providerId: string }>;
    if (!Array.isArray(allowedSources) || allowedSources.length === 0) {
      throw new SettlementError(
        "SETTLEMENT_INVALID_PROOF",
        "Template has no allowed sources",
        400,
      );
    }

    const urlHost = new URL(proof.sourceUrl).hostname;
    const allowed = allowedSources.some((s) => urlHost.includes(s.providerId));
    if (!allowed) {
      throw new SettlementError(
        "SETTLEMENT_INVALID_PROOF",
        `Source ${urlHost} not in allowed list`,
        400,
      );
    }
  }

  async resolve(input: ResolveBetInput): Promise<ResolveBetResult> {
    // P22 stub: returns proof's claimed result.
    // P23+ implements: fetch from sourceUrl, parse, validate.
    const proof = input.proof as {
      sourceUrl: string;
      resultData: { winnerSide: "A" | "B" | "VOID" };
    };
    return {
      winnerSide: proof.resultData.winnerSide,
      resolvedAt: new Date(),
      evidence: {
        type: "official_result",
        sourceUrl: proof.sourceUrl,
        fetchedData: proof.resultData,
      },
      method: "OFFICIAL_RESULT",
    };
  }
}
