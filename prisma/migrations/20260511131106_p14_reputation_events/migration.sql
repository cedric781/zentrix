-- CreateEnum
CREATE TYPE "ReputationEventType" AS ENUM ('BET_SETTLED_CLEAN', 'DISPUTE_OPENED', 'DISPUTE_WON', 'DISPUTE_LOST', 'DISPUTE_VOID', 'FORCE_CANCELLED', 'BET_EXPIRED', 'ADMIN_PENALTY', 'ADMIN_BONUS');

-- AlterTable
ALTER TABLE "user_reputations" ALTER COLUMN "score" SET DEFAULT 500;

-- CreateTable
CREATE TABLE "reputation_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" "ReputationEventType" NOT NULL,
    "score_delta" INTEGER NOT NULL,
    "score_after" INTEGER NOT NULL,
    "tier_before" "ReputationTier" NOT NULL,
    "tier_after" "ReputationTier" NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "metadata" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reputation_events_idempotency_key_key" ON "reputation_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_reputation_events_user" ON "reputation_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_reputation_events_type" ON "reputation_events"("event_type");

-- CreateIndex
CREATE INDEX "idx_reputation_events_ref" ON "reputation_events"("ref_type", "ref_id");

-- AddForeignKey
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
