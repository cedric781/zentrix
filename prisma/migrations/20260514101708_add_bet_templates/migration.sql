-- CreateEnum
CREATE TYPE "SettlementType" AS ENUM ('BINARY', 'THRESHOLD');

-- CreateTable
CREATE TABLE "bet_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "settlement_type" "SettlementType" NOT NULL,
    "outcome_type" TEXT NOT NULL,
    "fields_schema" JSONB NOT NULL,
    "allowed_sources" JSONB NOT NULL,
    "resolution_rule" TEXT NOT NULL,
    "supports_auto_resolve" BOOLEAN NOT NULL DEFAULT false,
    "requires_official_event" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bet_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bet_templates_slug_key" ON "bet_templates"("slug");

-- CreateIndex
CREATE INDEX "idx_bet_templates_slug" ON "bet_templates"("slug");

-- CreateIndex
CREATE INDEX "idx_bet_templates_category_active" ON "bet_templates"("category", "is_active", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_bet_templates_settlement_type" ON "bet_templates"("settlement_type");

-- CreateIndex
CREATE INDEX "idx_bet_templates_soft_delete" ON "bet_templates"("deleted_at", "is_active");
