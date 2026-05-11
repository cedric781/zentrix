import "server-only";
import type {
  ReputationEvent,
  ReputationEventType,
  UserReputation,
} from "@prisma/client";
import type { TxClient } from "@/lib/ledger";

export interface TrackReputationEventInput {
  tx: TxClient;
  userId: string;
  eventType: ReputationEventType;
  refType?: string;
  refId?: string;
  metadata?: Record<string, unknown>;
  customDelta?: number;
}

export interface TrackReputationEventResult {
  event: ReputationEvent;
  reputation: UserReputation;
  tierChanged: boolean;
}

export type { ReputationEvent, ReputationEventType, UserReputation };
