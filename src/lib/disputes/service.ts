import "server-only";
import type { Bet, Dispute } from "@prisma/client";
import { type TxClient } from "@/lib/ledger";
import { DisputeError } from "./errors";

// ── helpers ──────────────────────────────────────────────────────────

export async function lockDispute(
  tx: TxClient,
  disputeId: string,
): Promise<{ id: string }> {
  const rows = (await tx.$queryRaw`
    SELECT id FROM disputes WHERE id = ${disputeId} FOR UPDATE
  `) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new DisputeError(
      "DISPUTE_NOT_FOUND",
      `Dispute ${disputeId} not found`,
      404,
    );
  }
  return { id: rows[0].id };
}

// ── service inputs/outputs ───────────────────────────────────────────

export interface OpenDisputeInput {
  betId: string;
  openerId: string;
  reason: string;
  idempotencyKey: string;
}

export interface OpenDisputeResult {
  dispute: Dispute;
  depositUnits: bigint;
  ledgerTxId: string;
}

export interface SubmitDisputeEvidenceInput {
  disputeId: string;
  uploaderId: string;
  items: Array<{
    type: "TEXT" | "URL" | "IMAGE" | "VIDEO";
    fileUrl?: string;
    contentHash: string;
    description?: string;
  }>;
  idempotencyKey: string;
}

export interface SubmitDisputeEvidenceResult {
  dispute: Dispute;
  evidenceAdded: number;
  evidenceTotal: number;
}

export interface ResolveDisputeInput {
  disputeId: string;
  adminId: string;
  outcome: "CREATOR_WINS" | "OPPONENT_WINS" | "VOID";
  adminNotes?: string;
  idempotencyKey: string;
}

export interface ResolveDisputeResult {
  dispute: Dispute;
  bet: Bet;
  ledgerTxIds: string[];
}

export interface ForceCancelBetInput {
  betId: string;
  adminId: string;
  reason: string;
  idempotencyKey: string;
}

export interface ForceCancelBetResult {
  bet: Bet;
  ledgerTxId: string | null;
}

// ── service stubs (to be implemented in fase B+) ─────────────────────

export async function openDispute(
  _input: OpenDisputeInput,
): Promise<OpenDisputeResult> {
  throw new Error("openDispute: not implemented");
}

export async function submitDisputeEvidence(
  _input: SubmitDisputeEvidenceInput,
): Promise<SubmitDisputeEvidenceResult> {
  throw new Error("submitDisputeEvidence: not implemented");
}

export async function resolveDispute(
  _input: ResolveDisputeInput,
): Promise<ResolveDisputeResult> {
  throw new Error("resolveDispute: not implemented");
}

export async function forceCancelBet(
  _input: ForceCancelBetInput,
): Promise<ForceCancelBetResult> {
  throw new Error("forceCancelBet: not implemented");
}
