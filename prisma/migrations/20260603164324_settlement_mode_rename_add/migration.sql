-- Rename the existing PROOF_CONFIRM label to PEER_AGREE (the engine it actually
-- maps to: peer propose/confirm). Existing rows follow automatically (label-only
-- change on the enum OID; no data write). The column DEFAULT and any stored
-- expressions referencing the old label are remapped by Postgres.
ALTER TYPE "SettlementMode" RENAME VALUE 'PROOF_CONFIRM' TO 'PEER_AGREE';

-- Add the objective auto-resolve mode. Additive; existing rows unaffected.
ALTER TYPE "SettlementMode" ADD VALUE 'AUTO_VERIFY';
