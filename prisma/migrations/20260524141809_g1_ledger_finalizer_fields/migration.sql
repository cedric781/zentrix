-- CreateEnum
CREATE TYPE "LedgerSettlementStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'FINALIZED', 'FAILED', 'FAILED_TERMINAL');

-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "ledger_error_code" TEXT,
ADD COLUMN     "ledger_finalized_at" TIMESTAMP(3),
ADD COLUMN     "ledger_last_error" TEXT,
ADD COLUMN     "ledger_next_retry_at" TIMESTAMP(3),
ADD COLUMN     "ledger_outcome" TEXT,
ADD COLUMN     "ledger_processing_at" TIMESTAMP(3),
ADD COLUMN     "ledger_processing_by" TEXT,
ADD COLUMN     "ledger_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ledger_status" "LedgerSettlementStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "ledger_target_winner_id" TEXT;

-- CreateIndex
CREATE INDEX "idx_bets_ledger_retry" ON "bets"("ledger_status", "ledger_next_retry_at");

-- CreateIndex
CREATE INDEX "idx_bets_status_ledger" ON "bets"("status", "ledger_status");

