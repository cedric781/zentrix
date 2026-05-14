import type {
  ResolveBetInput,
  ResolveBetResult,
  SettlementMethodService,
} from "../types";
import { SettlementError } from "../types";

export class PlatformProofService implements SettlementMethodService {
  readonly method = "PLATFORM_PROOF" as const;

  validate(input: ResolveBetInput): void {
    if (!input.proof) {
      throw new SettlementError(
        "SETTLEMENT_INVALID_PROOF",
        "Proof required for PLATFORM_PROOF",
        400,
      );
    }
    const proof = input.proof as { winnerSide?: string };
    if (!proof.winnerSide || !["A", "B", "VOID"].includes(proof.winnerSide)) {
      throw new SettlementError(
        "SETTLEMENT_INVALID_PROOF",
        "winnerSide must be A, B, or VOID",
        400,
      );
    }
  }

  async resolve(input: ResolveBetInput): Promise<ResolveBetResult> {
    // P22 doesn't call settleBet itself — that's API layer concern (P23).
    // P22 returns the resolution decision, API caller commits via existing bet service.
    const proof = input.proof as { winnerSide: "A" | "B" | "VOID" };
    return {
      winnerSide: proof.winnerSide,
      resolvedAt: new Date(),
      evidence: { type: "platform_proof", initiatorUserId: input.initiatorUserId },
      method: "PLATFORM_PROOF",
    };
  }
}
