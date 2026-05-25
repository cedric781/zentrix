-- CreateEnum
CREATE TYPE "EscrowDepositStatus" AS ENUM ('PENDING_CREATOR', 'PENDING_OPPONENT', 'LOCKED', 'FAILED', 'FAILED_TERMINAL');

-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "escrow_creator_attempted_at" TIMESTAMP(3),
ADD COLUMN     "escrow_deposit_creator_tx_sig" TEXT,
ADD COLUMN     "escrow_deposit_last_error" TEXT,
ADD COLUMN     "escrow_deposit_next_retry_at" TIMESTAMP(3),
ADD COLUMN     "escrow_deposit_opponent_tx_sig" TEXT,
ADD COLUMN     "escrow_deposit_processing_at" TIMESTAMP(3),
ADD COLUMN     "escrow_deposit_processing_by" TEXT,
ADD COLUMN     "escrow_deposit_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "escrow_deposit_status" "EscrowDepositStatus",
ADD COLUMN     "escrow_locked_at" TIMESTAMP(3),
ADD COLUMN     "escrow_opponent_attempted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_bets_escrow_deposit_retry" ON "bets"("escrow_deposit_status", "escrow_deposit_next_retry_at");

