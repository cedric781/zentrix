-- AlterEnum
ALTER TYPE "ReputationEventType" ADD VALUE 'BET_SETTLED_AUTO';

-- CreateTable
CREATE TABLE "bet_external_refs" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "event_starts_at" TIMESTAMP(3) NOT NULL,
    "event_ends_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "resolved_winner_side" TEXT,
    "resolved_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bet_external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_provider_health" (
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CLOSED',
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "last_failure_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "cooldown_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_provider_health_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE UNIQUE INDEX "bet_external_refs_bet_id_key" ON "bet_external_refs"("bet_id");

-- CreateIndex
CREATE INDEX "idx_bet_external_refs_provider_ends" ON "bet_external_refs"("provider", "event_ends_at");

-- CreateIndex
CREATE INDEX "idx_bet_external_refs_ends" ON "bet_external_refs"("event_ends_at");

-- CreateIndex
CREATE INDEX "idx_bet_external_refs_processed" ON "bet_external_refs"("processed_at");

-- AddForeignKey
ALTER TABLE "bet_external_refs" ADD CONSTRAINT "bet_external_refs_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
