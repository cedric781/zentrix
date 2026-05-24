-- AlterTable
ALTER TABLE "bet_external_refs" ADD COLUMN     "last_attempt_at" TIMESTAMP(3),
ADD COLUMN     "next_retry_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_bet_external_refs_next_retry" ON "bet_external_refs"("next_retry_at", "processed_at");
