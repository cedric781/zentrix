import type {
  Bet,
  BetResultClaim,
  BetParticipantConfirmation,
  Dispute,
  Match,
} from "@prisma/client";
import { bigToStr } from "./bigint";

export function serializeBet(bet: Bet) {
  return {
    id: bet.id,
    status: bet.status,
    createdById: bet.createdById,
    opponentUserId: bet.opponentUserId,
    creatorSide: bet.creatorSide,
    acceptorSide: bet.acceptorSide,
    stakeUnits: bigToStr(bet.stakeUnits),
    settlementMode: bet.settlementMode,
    resultStatus: bet.resultStatus,
    winnerId: bet.winnerId,
    version: bet.version,
    poolId: bet.poolId,
    matchId: bet.matchId,
    expiresAt: bet.expiresAt.toISOString(),
    confirmDeadline: bet.confirmDeadline?.toISOString() ?? null,
    disputeWindowEndsAt: bet.disputeWindowEndsAt?.toISOString() ?? null,
    settledAt: bet.settledAt?.toISOString() ?? null,
    cancelledAt: bet.cancelledAt?.toISOString() ?? null,
    voidedAt: bet.voidedAt?.toISOString() ?? null,
    createdAt: bet.createdAt.toISOString(),
    updatedAt: bet.updatedAt.toISOString(),
  };
}

export function serializeBetResultClaim(claim: BetResultClaim) {
  return {
    id: claim.id,
    betId: claim.betId,
    claimedById: claim.claimedById,
    claimedWinnerId: claim.claimedWinnerId,
    note: claim.note,
    createdAt: claim.createdAt.toISOString(),
  };
}

export function serializeBetParticipantConfirmation(
  confirmation: BetParticipantConfirmation,
) {
  return {
    id: confirmation.id,
    betId: confirmation.betId,
    userId: confirmation.userId,
    decision: confirmation.decision,
    claimedWinnerId: confirmation.claimedWinnerId,
    createdAt: confirmation.createdAt.toISOString(),
  };
}

export function serializeDispute(dispute: Dispute) {
  return {
    id: dispute.id,
    betId: dispute.betId,
    openedById: dispute.openedById,
    reason: dispute.reason,
    status: dispute.status,
    outcome: dispute.outcome,
    resolvedById: dispute.resolvedById,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    depositLedgerTxId: dispute.depositLedgerTxId,
    adminNotes: dispute.adminNotes,
    createdAt: dispute.createdAt.toISOString(),
    updatedAt: dispute.updatedAt.toISOString(),
  };
}

export function serializeMatch(match: Match) {
  return {
    id: match.id,
    poolId: match.poolId,
    title: match.title,
    description: match.description,
    status: match.status,
    winnerSide: match.winnerSide,
    eventTime: match.eventTime?.toISOString() ?? null,
    submittedAt: match.submittedAt?.toISOString() ?? null,
    disputeWindowEndsAt: match.disputeWindowEndsAt?.toISOString() ?? null,
    settledAt: match.settledAt?.toISOString() ?? null,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
  };
}
