-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SIMPLE', 'SINGLE_ELIM', 'DOUBLE_ELIM');

-- CreateEnum
CREATE TYPE "BracketSide" AS ENUM ('WINNERS', 'LOSERS', 'FINAL');

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "bracket" "BracketSide",
ADD COLUMN     "bracket_slot" TEXT,
ADD COLUMN     "next_match_id_on_loss" TEXT,
ADD COLUMN     "next_match_id_on_win" TEXT,
ADD COLUMN     "participant_a_id" TEXT,
ADD COLUMN     "participant_b_id" TEXT,
ADD COLUMN     "round" INTEGER,
ADD COLUMN     "winner_participant_id" TEXT;

-- AlterTable
ALTER TABLE "pools" ADD COLUMN     "bracket_locked_at" TIMESTAMP(3),
ADD COLUMN     "tournament_format" "TournamentFormat" NOT NULL DEFAULT 'SIMPLE';

-- CreateTable
CREATE TABLE "pool_participants" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pool_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pool_participants_pool" ON "pool_participants"("pool_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pool_participants_pool_seed" ON "pool_participants"("pool_id", "seed");

-- CreateIndex
CREATE INDEX "idx_matches_participant_a" ON "matches"("participant_a_id");

-- CreateIndex
CREATE INDEX "idx_matches_participant_b" ON "matches"("participant_b_id");

-- CreateIndex
CREATE INDEX "idx_matches_pool_round_bracket" ON "matches"("pool_id", "round", "bracket");

-- CreateIndex
CREATE INDEX "idx_pools_tournament_format" ON "pools"("tournament_format");

-- AddForeignKey
ALTER TABLE "pool_participants" ADD CONSTRAINT "pool_participants_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_participant_a_id_fkey" FOREIGN KEY ("participant_a_id") REFERENCES "pool_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_participant_b_id_fkey" FOREIGN KEY ("participant_b_id") REFERENCES "pool_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_participant_id_fkey" FOREIGN KEY ("winner_participant_id") REFERENCES "pool_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_next_match_id_on_win_fkey" FOREIGN KEY ("next_match_id_on_win") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_next_match_id_on_loss_fkey" FOREIGN KEY ("next_match_id_on_loss") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

