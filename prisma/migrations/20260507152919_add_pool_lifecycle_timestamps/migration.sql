-- Phase 2 P09 — add lifecycle timestamps on Pool.
-- Hand-authored: Prisma migrate dev --create-only crashed with NT
-- access-violation on this Windows box (see
-- feedback_prisma_migrate_crash_recovery). DDL matches what Prisma
-- would have generated for the schema additions:
--   publishedAt DateTime? @map("published_at")
--   closedAt    DateTime? @map("closed_at")

ALTER TABLE "pools" ADD COLUMN "published_at" TIMESTAMP(3);
ALTER TABLE "pools" ADD COLUMN "closed_at" TIMESTAMP(3);