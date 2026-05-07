-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'SETTLEMENT_PENDING', 'SETTLED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PoolSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "PoolWinningSide" AS ENUM ('A', 'B', 'VOID');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('SCHEDULED', 'DISPUTED_HOLD', 'PAID_OUT', 'FAILED', 'REFUNDED_INSTEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'BET_PLACEMENT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'BET_REFUND';

-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "side_a_label" TEXT NOT NULL,
    "side_b_label" TEXT NOT NULL,
    "betting_closes_at" TIMESTAMP(3) NOT NULL,
    "settlement_delay_hours" INTEGER NOT NULL DEFAULT 24,
    "status" "PoolStatus" NOT NULL DEFAULT 'DRAFT',
    "creator_fee_bps" INTEGER NOT NULL DEFAULT 100,
    "total_pot_units" BIGINT NOT NULL DEFAULT 0,
    "total_side_a_units" BIGINT NOT NULL DEFAULT 0,
    "total_side_b_units" BIGINT NOT NULL DEFAULT 0,
    "winning_side" "PoolWinningSide",
    "declared_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_entries" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "side" "PoolSide" NOT NULL,
    "amount_units" BIGINT NOT NULL,
    "ledger_tx_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_logs" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_jobs" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "declared_winner" "PoolWinningSide" NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "status" "SettlementStatus" NOT NULL DEFAULT 'SCHEDULED',
    "fail_reason" TEXT,

    CONSTRAINT "settlement_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pools_status" ON "pools"("status");

-- CreateIndex
CREATE INDEX "idx_pools_betting_closes_at" ON "pools"("betting_closes_at");

-- CreateIndex
CREATE INDEX "idx_pools_creator_created" ON "pools"("created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_pool_entries_pool_side" ON "pool_entries"("pool_id", "side");

-- CreateIndex
CREATE INDEX "idx_pool_entries_user_created" ON "pool_entries"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pool_entries_pool_user" ON "pool_entries"("pool_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_dispute_logs_pool_created" ON "dispute_logs"("pool_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_dispute_logs_user_created" ON "dispute_logs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_jobs_pool_id_key" ON "settlement_jobs"("pool_id");

-- CreateIndex
CREATE INDEX "idx_settlement_jobs_status_scheduled" ON "settlement_jobs"("status", "scheduled_for");

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_entries" ADD CONSTRAINT "pool_entries_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_entries" ADD CONSTRAINT "pool_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_logs" ADD CONSTRAINT "dispute_logs_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_logs" ADD CONSTRAINT "dispute_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_jobs" ADD CONSTRAINT "settlement_jobs_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- HAND-APPENDED (not Prisma-generated): Phase 2 invariant trigger.
--
-- ADR-0002 mitigation 1: creator-cannot-bet must be enforced at the DB
-- level, not just in the API. A user who creates a pool MUST NOT have a
-- PoolEntry in that pool. This is enforced via a BEFORE INSERT/UPDATE
-- trigger rather than a CHECK constraint because Postgres CHECK with a
-- subquery is only validated row-by-row on the table being modified --
-- it does NOT fire on cross-row UPDATE of the referenced table (pools).
--
-- The trigger fires only on INSERT or on UPDATE of user_id / pool_id
-- (not on every column update -- cheaper). Error code 'check_violation'
-- (PG class 23) maps cleanly to a Prisma error so the API layer can
-- pattern-match. Both ids are embedded in the error message for
-- diagnosable logs without an extra join.
-- =====================================================================

CREATE OR REPLACE FUNCTION enforce_creator_cannot_bet()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pools
    WHERE id = NEW.pool_id
      AND created_by_user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION
      'creator-cannot-bet: user_id % is the creator of pool_id % (ADR-0002 mitigation 1)',
      NEW.user_id, NEW.pool_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_creator_cannot_bet
  BEFORE INSERT OR UPDATE OF user_id, pool_id ON pool_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_creator_cannot_bet();