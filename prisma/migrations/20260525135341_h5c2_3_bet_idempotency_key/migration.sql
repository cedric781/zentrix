-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bets_idempotency_key_key" ON "bets"("idempotency_key");

