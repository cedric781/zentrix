-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "accept_idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bets_accept_idempotency_key_key" ON "bets"("accept_idempotency_key");

