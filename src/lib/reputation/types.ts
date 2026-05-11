import "server-only";
import type { TxClient } from "@/lib/ledger";

// INTERIM TYPES: deze interface shape is gelocked, maar Prisma model types
// (eventType, event, reputation fields) komen pas met Fase B.0 schema migration.
// Tijdens B.1 service body implementatie tighten naar:
//   eventType: ReputationEventType
//   event: ReputationEvent
//   reputation: UserReputation

export interface TrackReputationEventInput {
  tx: TxClient;
  userId: string;
  eventType: string; // → ReputationEventType in B.0
  refType?: string;
  refId?: string;
  metadata?: Record<string, unknown>;
  customDelta?: number;
}

export interface TrackReputationEventResult {
  event: unknown;       // → ReputationEvent in B.0
  reputation: unknown;  // → UserReputation in B.0
  tierChanged: boolean;
}
