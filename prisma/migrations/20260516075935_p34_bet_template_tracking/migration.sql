-- AlterTable
ALTER TABLE "bets" ADD COLUMN     "category" TEXT,
ADD COLUMN     "is_custom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "template_id" TEXT;

-- CreateIndex
CREATE INDEX "idx_bets_status_created_at" ON "bets"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_bets_category_status_created_at" ON "bets"("category", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_bets_template_id" ON "bets"("template_id");
