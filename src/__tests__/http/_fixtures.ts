import type {
  Bet,
  BetParticipantConfirmation,
  BetResultClaim,
  Dispute,
  Match,
} from "@prisma/client";

const T0 = new Date("2026-05-12T10:00:00.000Z");
const T_PLUS_1D = new Date("2026-05-13T10:00:00.000Z");

export function mockBet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: "bet-1",
    createdById: "u1",
    opponentUserId: null,
    creatorSide: "A",
    acceptorSide: null,
    title: "",
    outcomeA: "",
    outcomeB: "",
    stakeUnits: 1000n,
    status: "OPEN",
    settlementMode: "PROOF_CONFIRM",
    resultStatus: "PENDING",
    winnerId: null,
    version: 1,
    expiresAt: T_PLUS_1D,
    confirmDeadline: null,
    disputeWindowEndsAt: null,
    settledAt: null,
    cancelledAt: null,
    voidedAt: null,
    poolId: null,
    matchId: null,
    createdByLedgerTxId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function mockClaim(overrides: Partial<BetResultClaim> = {}): BetResultClaim {
  return {
    id: "claim-1",
    betId: "bet-1",
    claimedById: "u1",
    claimedWinnerId: "u1",
    note: null,
    createdAt: T0,
    ...overrides,
  };
}

export function mockConfirmation(
  overrides: Partial<BetParticipantConfirmation> = {},
): BetParticipantConfirmation {
  return {
    id: "conf-1",
    betId: "bet-1",
    userId: "u1",
    decision: "CONFIRM_WINNER",
    claimedWinnerId: "u1",
    createdAt: T0,
    ...overrides,
  };
}

export function mockDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: "disp-1",
    betId: "bet-1",
    openedById: "u1",
    reason: "Match result is incorrect — opponent did not actually win",
    depositLedgerTxId: null,
    status: "OPEN",
    outcome: null,
    resolvedById: null,
    resolvedAt: null,
    adminNotes: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function mockMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-1",
    poolId: "pool-1",
    title: "Test match",
    description: null,
    eventTime: null,
    status: "RESULT_SUBMITTED",
    winnerSide: "A",
    submittedAt: T0,
    disputeWindowEndsAt: T_PLUS_1D,
    settledAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export const VALID_UUID = "11111111-1111-4111-8111-111111111111";
export const INVALID_UUID = "not-a-uuid";

export function makeReq(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
