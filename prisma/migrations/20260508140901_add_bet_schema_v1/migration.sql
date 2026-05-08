-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'RESULT_PROPOSED', 'AWAITING_CONFIRMATION', 'DISPUTED', 'SETTLED', 'CANCELLED', 'EXPIRED', 'VOID');
-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('PROOF_CONFIRM');
-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PENDING', 'PROPOSED', 'CONFIRMED', 'DISPUTED', 'OVERRIDDEN');
-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'RESULT_SUBMITTED', 'SETTLED', 'DISPUTED');
-- CreateEnum
CREATE TYPE "PoolStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'SETTLED', 'CANCELLED');
-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'EVIDENCE_PHASE', 'ADMIN_REVIEW', 'RESOLVED');
-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('CREATOR_WINS', 'OPPONENT_WINS', 'VOID');
-- CreateEnum
CREATE TYPE "ReputationTier" AS ENUM ('NORMAL', 'RESTRICTED', 'FLAGGED');
-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('TEXT', 'URL', 'IMAGE', 'VIDEO');
-- CreateEnum
CREATE TYPE "ConfirmationDecision" AS ENUM ('CONFIRM_WINNER', 'DISAGREE');
-- AlterTable
ALTER TABLE "idempotency_keys" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "response_json" JSONB,
ADD COLUMN     "route" TEXT,
ADD COLUMN     "status_code" INTEGER,
ADD COLUMN     "user_id" TEXT;
-- CreateTable
CREATE TABLE "bets" (
    "id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "opponent_user_id" TEXT,
    "creator_side" TEXT NOT NULL,
    "acceptor_side" TEXT,
    "stake_units" BIGINT NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'DRAFT',
    "settlement_mode" "SettlementMode" NOT NULL DEFAULT 'PROOF_CONFIRM',
    "result_status" "ResultStatus" NOT NULL DEFAULT 'PENDING',
    "winner_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirm_deadline" TIMESTAMP(3),
    "dispute_window_ends_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "pool_id" TEXT,
    "match_id" TEXT,
    "created_by_ledger_tx_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bets_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bet_participants" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "has_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bet_participants_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bet_invites" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_id" TEXT,
    CONSTRAINT "bet_invites_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bet_evidence" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "file_url" TEXT,
    "mime_type" TEXT,
    "content_hash" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bet_evidence_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bet_state_transitions" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "from_status" "BetStatus" NOT NULL,
    "to_status" "BetStatus" NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bet_state_transitions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bet_participant_confirmations" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "decision" "ConfirmationDecision" NOT NULL,
    "claimed_winner_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bet_participant_confirmations_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bet_result_claims" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "claimed_by_id" TEXT NOT NULL,
    "claimed_winner_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bet_result_claims_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "PoolStatus" NOT NULL DEFAULT 'DRAFT',
    "betting_closes_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "event_time" TIMESTAMP(3),
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winner_side" TEXT,
    "submitted_at" TIMESTAMP(3),
    "dispute_window_ends_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "match_evidence" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "file_url" TEXT,
    "mime_type" TEXT,
    "content_hash" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "match_evidence_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "bet_id" TEXT NOT NULL,
    "opened_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "deposit_ledger_tx_id" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "DisputeOutcome",
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "admin_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "user_reputations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 100,
    "disputes_opened" INTEGER NOT NULL DEFAULT 0,
    "disputes_won" INTEGER NOT NULL DEFAULT 0,
    "disputes_lost" INTEGER NOT NULL DEFAULT 0,
    "tier" "ReputationTier" NOT NULL DEFAULT 'NORMAL',
    "last_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_reputations_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "idx_bets_status" ON "bets"("status");
-- CreateIndex
CREATE INDEX "idx_bets_creator_created" ON "bets"("created_by_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_bets_opponent_created" ON "bets"("opponent_user_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_bets_pool_status" ON "bets"("pool_id", "status");
-- CreateIndex
CREATE INDEX "idx_bets_match_status" ON "bets"("match_id", "status");
-- CreateIndex
CREATE INDEX "idx_bets_expires_at" ON "bets"("expires_at");
-- CreateIndex
CREATE INDEX "idx_bet_participants_user_created" ON "bet_participants"("user_id", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "uq_bet_participants_bet_side" ON "bet_participants"("bet_id", "side");
-- CreateIndex
CREATE UNIQUE INDEX "uq_bet_participants_bet_user" ON "bet_participants"("bet_id", "user_id");
-- CreateIndex
CREATE UNIQUE INDEX "bet_invites_bet_id_key" ON "bet_invites"("bet_id");
-- CreateIndex
CREATE UNIQUE INDEX "bet_invites_token_hash_key" ON "bet_invites"("token_hash");
-- CreateIndex
CREATE INDEX "idx_bet_invites_expires" ON "bet_invites"("expires_at");
-- CreateIndex
CREATE INDEX "idx_bet_evidence_user_created" ON "bet_evidence"("uploaded_by_id", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "uq_bet_evidence_bet_hash" ON "bet_evidence"("bet_id", "content_hash");
-- CreateIndex
CREATE INDEX "idx_bet_state_transitions_bet_created" ON "bet_state_transitions"("bet_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_bet_state_transitions_actor_created" ON "bet_state_transitions"("actor_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_bet_confirmations_bet_created" ON "bet_participant_confirmations"("bet_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_bet_confirmations_user_created" ON "bet_participant_confirmations"("user_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_bet_result_claims_bet_created" ON "bet_result_claims"("bet_id", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "uq_bet_result_claims_bet_user" ON "bet_result_claims"("bet_id", "claimed_by_id");
-- CreateIndex
CREATE INDEX "idx_pools_status" ON "pools"("status");
-- CreateIndex
CREATE INDEX "idx_pools_creator_created" ON "pools"("created_by_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_matches_pool_status" ON "matches"("pool_id", "status");
-- CreateIndex
CREATE INDEX "idx_matches_event_time" ON "matches"("event_time");
-- CreateIndex
CREATE INDEX "idx_match_evidence_user_created" ON "match_evidence"("uploaded_by_id", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "uq_match_evidence_match_hash" ON "match_evidence"("match_id", "content_hash");
-- CreateIndex
CREATE INDEX "idx_disputes_bet_status" ON "disputes"("bet_id", "status");
-- CreateIndex
CREATE INDEX "idx_disputes_opener_created" ON "disputes"("opened_by_id", "created_at");
-- CreateIndex
CREATE INDEX "idx_disputes_status_created" ON "disputes"("status", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "user_reputations_user_id_key" ON "user_reputations"("user_id");
-- CreateIndex
CREATE INDEX "idx_user_reputation_tier" ON "user_reputations"("tier");
-- CreateIndex
CREATE INDEX "idx_user_reputation_score" ON "user_reputations"("score");
-- CreateIndex
CREATE INDEX "idx_idem_expires" ON "idempotency_keys"("expires_at");
-- CreateIndex
CREATE INDEX "idx_idem_user_route_created" ON "idempotency_keys"("user_id", "route", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "uq_idem_user_key" ON "idempotency_keys"("user_id", "key");
-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_opponent_user_id_fkey" FOREIGN KEY ("opponent_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_participants" ADD CONSTRAINT "bet_participants_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_participants" ADD CONSTRAINT "bet_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_invites" ADD CONSTRAINT "bet_invites_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_invites" ADD CONSTRAINT "bet_invites_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_evidence" ADD CONSTRAINT "bet_evidence_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_evidence" ADD CONSTRAINT "bet_evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_state_transitions" ADD CONSTRAINT "bet_state_transitions_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_state_transitions" ADD CONSTRAINT "bet_state_transitions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_participant_confirmations" ADD CONSTRAINT "bet_participant_confirmations_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_participant_confirmations" ADD CONSTRAINT "bet_participant_confirmations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_participant_confirmations" ADD CONSTRAINT "bet_participant_confirmations_claimed_winner_id_fkey" FOREIGN KEY ("claimed_winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_result_claims" ADD CONSTRAINT "bet_result_claims_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_result_claims" ADD CONSTRAINT "bet_result_claims_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "bet_result_claims" ADD CONSTRAINT "bet_result_claims_claimed_winner_id_fkey" FOREIGN KEY ("claimed_winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "match_evidence" ADD CONSTRAINT "match_evidence_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "match_evidence" ADD CONSTRAINT "match_evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_bet_id_fkey" FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "user_reputations" ADD CONSTRAINT "user_reputations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── BetCannotBetOnOwnPoolMatch trigger (P08, ADR-0003 + REFACTOR_PLAN) ─────
CREATE OR REPLACE FUNCTION bets_creator_cannot_bet_on_own_pool_match()
RETURNS TRIGGER AS $$
DECLARE
  pool_creator_id text;
BEGIN
  IF NEW.pool_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT created_by_id INTO pool_creator_id FROM pools WHERE id = NEW.pool_id;

  IF pool_creator_id IS NULL THEN
    RAISE EXCEPTION 'Bet refers to non-existent pool (pool_id=%)', NEW.pool_id;
  END IF;

  IF pool_creator_id = NEW.created_by_id OR pool_creator_id = NEW.opponent_user_id THEN
    RAISE EXCEPTION 'Pool creator cannot bet on own pool (pool_id=%, creator=%)',
      NEW.pool_id, pool_creator_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bets_creator_cannot_bet_on_own_pool_match ON bets;
CREATE TRIGGER bets_creator_cannot_bet_on_own_pool_match
  BEFORE INSERT OR UPDATE ON bets
  FOR EACH ROW EXECUTE FUNCTION bets_creator_cannot_bet_on_own_pool_match();

-- Defense-in-depth: matchId requires poolId
ALTER TABLE bets ADD CONSTRAINT bet_match_requires_pool
  CHECK (match_id IS NULL OR pool_id IS NOT NULL);
