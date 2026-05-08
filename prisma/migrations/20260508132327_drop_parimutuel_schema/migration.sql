-- Drop parimutuel pool schema per ADR-0003 + REFACTOR_PLAN
-- Forward-only migration: bestaande P08-09 migrations blijven in history.

DROP TRIGGER IF EXISTS pool_entries_creator_cannot_bet ON pool_entries;
DROP TABLE IF EXISTS pool_entries CASCADE;
DROP TABLE IF EXISTS dispute_logs CASCADE;
DROP TABLE IF EXISTS settlement_jobs CASCADE;
DROP TABLE IF EXISTS pools CASCADE;

DROP TYPE IF EXISTS "PoolStatus";
DROP TYPE IF EXISTS "PoolSide";
DROP TYPE IF EXISTS "PoolWinningSide";
DROP TYPE IF EXISTS "SettlementStatus";
