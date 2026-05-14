-- CreateEnum
CREATE TYPE "SettlementMethod" AS ENUM ('OFFICIAL_RESULT', 'ORACLE_VALUE', 'PLATFORM_PROOF', 'THRESHOLD_METRIC');

-- AlterTable
ALTER TABLE "bet_templates" ADD COLUMN     "settlement_method" "SettlementMethod" NOT NULL DEFAULT 'PLATFORM_PROOF';
