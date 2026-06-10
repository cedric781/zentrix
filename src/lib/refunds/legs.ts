/**
 * PHASE 3a — refund-leg builder.
 *
 * Refund legs are DERIVED from the ledger refund entries a path actually wrote
 * (escrow→creator, and escrow→opponent when present) — never from
 * stakeUnits × N. Keying off the real entries is what lets single-sided
 * (expire) and double-sided (auto-VOID) refunds, and ESCROW_RELEASE vs
 * BET_REFUND entryTypes, all work without per-path assumptions: one entry in →
 * one payable leg out.
 *
 * Pure + side-effect-free so it is trivially unit-testable. No DB, no RPC.
 */

export type RefundLegStatus = "pending" | "submitted" | "confirmed";

export interface RefundLeg {
  side: "creator" | "opponent";
  destOwner: string;
  amountUnits: string;
  ledgerEntryId: string;
  txSig: string | null;
  status: RefundLegStatus;
}

/** Minimal shape of a written refund ledger entry (escrow debit → participant credit). */
export interface RefundLedgerEntry {
  id: string;
  creditAccountId: string;
  amountUnits: bigint;
}

/**
 * A participant who may be owed a refund leg. `accountId` is that participant's
 * USER financial-account id — it matches the `creditAccountId` of the ledger
 * entry that refunded them, which is how each entry is mapped back to a side.
 * `destOwner` is their on-chain wallet (embeddedWalletAddress), possibly null.
 */
export interface RefundParticipant {
  side: "creator" | "opponent";
  accountId: string;
  destOwner: string | null;
}

const SIDE_ORDER: Record<RefundLeg["side"], number> = { creator: 0, opponent: 1 };

/**
 * Build the per-participant refund legs for a bet from the ledger entries that
 * actually credited each participant.
 *
 * For each entry: the leg's `side`/`destOwner` come from the participant whose
 * account the entry CREDITED; `amountUnits` is the entry's own amount (string);
 * `ledgerEntryId` ties the leg to its ledger row; `txSig`/`status` start at
 * null/"pending".
 *
 * Throws (rather than silently dropping a leg) when an entry credits an account
 * with no matching participant, or when a participant we must pay has no wallet
 * — an unpayable refund must surface loudly. Legs are returned creator-first.
 */
export function buildRefundLegs(
  entries: RefundLedgerEntry[],
  participants: RefundParticipant[],
): RefundLeg[] {
  const byAccount = new Map(participants.map((p) => [p.accountId, p]));

  const legs: RefundLeg[] = entries.map((entry) => {
    const participant = byAccount.get(entry.creditAccountId);
    if (!participant) {
      throw new Error(
        `buildRefundLegs: ledger entry ${entry.id} credits account ${entry.creditAccountId} ` +
          `with no matching refund participant`,
      );
    }
    if (!participant.destOwner || participant.destOwner.trim() === "") {
      throw new Error(
        `buildRefundLegs: refund ${participant.side} (account ${participant.accountId}) has no ` +
          `wallet address — cannot build a payable leg`,
      );
    }
    return {
      side: participant.side,
      destOwner: participant.destOwner,
      amountUnits: entry.amountUnits.toString(),
      ledgerEntryId: entry.id,
      txSig: null,
      status: "pending",
    } satisfies RefundLeg;
  });

  return legs.sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
}
