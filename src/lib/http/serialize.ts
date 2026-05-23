import type {
  Bet,
  BetResultClaim,
  BetParticipantConfirmation,
  BetTemplate,
  Deposit,
  Dispute,
  FinancialAccount,
  Match,
  Pool,
  PoolParticipant,
  User,
  UserReputation,
} from "@prisma/client";
import { bigToStr } from "./bigint";

/**
 * Bet with optional hydrated latest claim. Callers that include
 * `resultClaims[0]` pass it via this shape; callers without include
 * pass plain Bet (latestClaim defaults to undefined → serialized null).
 */
export type BetWithLatestClaim = Bet & {
  latestClaim?: BetResultClaim | null;
};

export function serializeBet(bet: BetWithLatestClaim) {
  return {
    id: bet.id,
    status: bet.status,
    title: bet.title,
    createdById: bet.createdById,
    opponentUserId: bet.opponentUserId,
    creatorSide: bet.creatorSide,
    acceptorSide: bet.acceptorSide,
    outcomeA: bet.outcomeA,
    outcomeB: bet.outcomeB,
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
    templateId: bet.templateId,
    category: bet.category,
    isCustom: bet.isCustom,
    createdAt: bet.createdAt.toISOString(),
    updatedAt: bet.updatedAt.toISOString(),
    latestClaim: bet.latestClaim
      ? serializeBetResultClaim(bet.latestClaim)
      : null,
  };
}

export function serializeTemplate(template: BetTemplate) {
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    category: template.category,
    description: template.description,
    settlementType: template.settlementType,
    settlementMethod: template.settlementMethod,
    outcomeType: template.outcomeType,
    fieldsSchema: template.fieldsSchema,
    allowedSources: template.allowedSources,
    resolutionRule: template.resolutionRule,
    supportsAutoResolve: template.supportsAutoResolve,
    requiresOfficialEvent: template.requiresOfficialEvent,
    isActive: template.isActive,
    version: template.version,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
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

export function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    embeddedWalletAddress: user.embeddedWalletAddress,
    walletDelegatedAt: user.walletDelegatedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * Admin variant: includes privyId for admin console / audit lookups.
 * Should ONLY be used in /api/admin/* routes behind requireAdmin().
 */
export function serializeUserAdmin(
  u: User & { financialAccount?: FinancialAccount | null },
) {
  return {
    id: u.id,
    privyId: u.privyId,
    email: u.email,
    embeddedWalletAddress: u.embeddedWalletAddress,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    financialAccount: u.financialAccount
      ? serializeFinancialAccount(u.financialAccount)
      : null,
  };
}

export function serializePool(pool: Pool) {
  return {
    id: pool.id,
    createdById: pool.createdById,
    title: pool.title,
    description: pool.description,
    status: pool.status,
    bettingClosesAt: pool.bettingClosesAt.toISOString(),
    createdAt: pool.createdAt.toISOString(),
    updatedAt: pool.updatedAt.toISOString(),
  };
}

export function serializePoolParticipant(p: PoolParticipant) {
  return {
    id: p.id,
    poolId: p.poolId,
    displayName: p.displayName,
    seed: p.seed,
    createdAt: p.createdAt.toISOString(),
  };
}

export function serializeReputation(rep: UserReputation) {
  return {
    userId: rep.userId,
    score: rep.score,
    tier: rep.tier,
    disputesOpened: rep.disputesOpened,
    disputesWon: rep.disputesWon,
    disputesLost: rep.disputesLost,
    lastUpdatedAt: rep.lastUpdatedAt.toISOString(),
  };
}

export function serializeDeposit(deposit: Deposit) {
  return {
    id: deposit.id,
    userId: deposit.userId,
    txSignature: deposit.txSignature,
    logIndex: deposit.logIndex,
    amountUnits: bigToStr(deposit.amountUnits),
    slot: bigToStr(deposit.slot),
    status: deposit.status,
    ledgerTxId: deposit.ledgerTxId,
    createdAt: deposit.createdAt.toISOString(),
    creditedAt: deposit.creditedAt?.toISOString() ?? null,
  };
}

export function serializeFinancialAccount(fa: FinancialAccount) {
  return {
    id: fa.id,
    accountType: fa.accountType,
    balanceUnits: bigToStr(fa.balanceUnits),
    updatedAt: fa.updatedAt.toISOString(),
  };
}

export interface PaginationCursorMeta {
  nextCursor: string | null;
}

export interface PaginationOffsetMeta {
  total: number;
  offset: number;
  take: number;
  hasMore: boolean;
}

export type PaginationMeta = PaginationCursorMeta | PaginationOffsetMeta;

export function serializePagination<T>(items: T[], meta: PaginationMeta) {
  return { items, ...meta };
}
