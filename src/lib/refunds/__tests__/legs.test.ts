import { describe, it, expect } from "vitest";
import {
  buildRefundLegs,
  type RefundLedgerEntry,
  type RefundParticipant,
} from "../legs";

const CREATOR: RefundParticipant = { side: "creator", accountId: "acct-c", destOwner: "WalletCreator11" };
const OPPONENT: RefundParticipant = { side: "opponent", accountId: "acct-o", destOwner: "WalletOpponent22" };

describe("buildRefundLegs", () => {
  it("single-sided → one creator leg with amount/dest from the entry", () => {
    const entries: RefundLedgerEntry[] = [
      { id: "e1", creditAccountId: "acct-c", amountUnits: 1000n },
    ];

    const legs = buildRefundLegs(entries, [CREATOR]);

    expect(legs).toEqual([
      {
        side: "creator",
        destOwner: "WalletCreator11",
        amountUnits: "1000",
        ledgerEntryId: "e1",
        txSig: null,
        status: "pending",
      },
    ]);
  });

  it("double-sided → two legs, creator-first even when entries arrive opponent-first", () => {
    const entries: RefundLedgerEntry[] = [
      { id: "e-opp", creditAccountId: "acct-o", amountUnits: 1000n },
      { id: "e-cre", creditAccountId: "acct-c", amountUnits: 1000n },
    ];

    const legs = buildRefundLegs(entries, [CREATOR, OPPONENT]);

    expect(legs.map((l) => l.side)).toEqual(["creator", "opponent"]);
    expect(legs[0]).toMatchObject({ ledgerEntryId: "e-cre", destOwner: "WalletCreator11" });
    expect(legs[1]).toMatchObject({ ledgerEntryId: "e-opp", destOwner: "WalletOpponent22" });
  });

  it("amounts are taken from the ledger entries, NOT assumed equal/stakeUnits×N", () => {
    const entries: RefundLedgerEntry[] = [
      { id: "e1", creditAccountId: "acct-c", amountUnits: 777n },
      { id: "e2", creditAccountId: "acct-o", amountUnits: 4242n },
    ];

    const legs = buildRefundLegs(entries, [CREATOR, OPPONENT]);

    expect(legs.find((l) => l.side === "creator")?.amountUnits).toBe("777");
    expect(legs.find((l) => l.side === "opponent")?.amountUnits).toBe("4242");
  });

  it("participant lacking a wallet → throws (never silently drops a leg)", () => {
    const entries: RefundLedgerEntry[] = [
      { id: "e1", creditAccountId: "acct-c", amountUnits: 1000n },
    ];
    const noWallet: RefundParticipant = { side: "creator", accountId: "acct-c", destOwner: null };

    expect(() => buildRefundLegs(entries, [noWallet])).toThrow(/no\s+wallet address/);
  });

  it("entry crediting an unknown account → throws (no matching participant)", () => {
    const entries: RefundLedgerEntry[] = [
      { id: "e1", creditAccountId: "acct-unknown", amountUnits: 1000n },
    ];

    expect(() => buildRefundLegs(entries, [CREATOR])).toThrow(/no matching refund participant/);
  });
});
