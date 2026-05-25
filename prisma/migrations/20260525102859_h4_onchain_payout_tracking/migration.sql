-- CreateEnum
CREATE TYPE "OnChainPayoutStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'FAILED_TERMINAL');

-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "on_chain_payout_status" "OnChainPayoutStatus",
ADD COLUMN     "payout_attempted_at" TIMESTAMP(3),
ADD COLUMN     "payout_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "payout_fee_tx_sig" TEXT,
ADD COLUMN     "payout_last_error" TEXT,
ADD COLUMN     "payout_next_retry_at" TIMESTAMP(3),
ADD COLUMN     "payout_processing_at" TIMESTAMP(3),
ADD COLUMN     "payout_processing_by" TEXT,
ADD COLUMN     "payout_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payout_winner_tx_sig" TEXT;

-- CreateIndex
CREATE INDEX "idx_bets_payout_retry" ON "bets"("on_chain_payout_status", "payout_next_retry_at");
