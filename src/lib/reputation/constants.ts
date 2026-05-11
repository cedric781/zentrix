import "server-only";
import type { ReputationEventType } from "@prisma/client";

export const REPUTATION_DELTAS: Record<ReputationEventType, number> = {
  BET_SETTLED_CLEAN: 2,
  DISPUTE_OPENED: -5,
  DISPUTE_WON: 15,
  DISPUTE_LOST: -25,
  DISPUTE_VOID: 0,
  FORCE_CANCELLED: 0,
  BET_EXPIRED: -2,
  ADMIN_PENALTY: 0,
  ADMIN_BONUS: 0,
};

export const REPUTATION_SCORE_MIN = 0;
export const REPUTATION_SCORE_MAX = 1000;
export const REPUTATION_SCORE_INITIAL = 500;

export const TIER_THRESHOLDS = {
  RESTRICTED_MIN: 200,
  NORMAL_MIN: 400,
} as const;

export const ADMIN_EVENT_TYPES: ReadonlyArray<ReputationEventType> = [
  "ADMIN_PENALTY",
  "ADMIN_BONUS",
];
