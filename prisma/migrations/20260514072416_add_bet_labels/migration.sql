-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "outcome_a" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outcome_b" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';
