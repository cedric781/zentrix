-- CreateEnum
CREATE TYPE "OnChainRefundStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'FAILED_TERMINAL');

-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "on_chain_refund_status" "OnChainRefundStatus",
ADD COLUMN     "refund_attempted_at" TIMESTAMP(3),
ADD COLUMN     "refund_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "refund_last_error" TEXT,
ADD COLUMN     "refund_legs" JSONB,
ADD COLUMN     "refund_next_retry_at" TIMESTAMP(3),
ADD COLUMN     "refund_processing_at" TIMESTAMP(3),
ADD COLUMN     "refund_processing_by" TEXT,
ADD COLUMN     "refund_retry_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "idx_bets_refund_retry" ON "bets"("on_chain_refund_status", "refund_next_retry_at");
