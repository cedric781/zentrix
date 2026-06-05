-- FASE 2.0 — evidence private Blob storage (bet_evidence + match_evidence)
-- Adds blob storage metadata and an upload lifecycle state.
-- Existing rows are pre-blob client-claimed fileUrls (never server-attested):
--   backfill them to LEGACY, then flip the column default to PENDING so future
--   client-direct uploads start life as PENDING and become STORED via the
--   onUploadCompleted webhook.

-- CreateEnum
CREATE TYPE "UploadState" AS ENUM ('LEGACY', 'PENDING', 'STORED');

-- AlterTable: bet_evidence
ALTER TABLE "bet_evidence"
  ADD COLUMN "blob_pathname" TEXT,
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "hash_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "upload_state" "UploadState" NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "bet_evidence" ALTER COLUMN "upload_state" SET DEFAULT 'PENDING';

-- AlterTable: match_evidence
ALTER TABLE "match_evidence"
  ADD COLUMN "blob_pathname" TEXT,
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "hash_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "upload_state" "UploadState" NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "match_evidence" ALTER COLUMN "upload_state" SET DEFAULT 'PENDING';
