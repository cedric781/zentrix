import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Smoke test only — exercises the ReconciliationLog table shape, not the
 * runReconciliation() engine itself. The engine's RPC path needs a Solana
 * connection mock to be safely tested, and TODO #1 nuance (users with
 * balance but no embedded wallet) makes a deterministic full-engine test
 * non-trivial in our test DB. Keep this file as a schema canary.
 */
describe("recon smoke", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ReconciliationLog accepts a balanced row with BigInt round-trip", async () => {
    const r = await prisma.reconciliationLog.create({
      data: {
        ledgerTotalUnits: 100n,
        onChainTotalUnits: 100n,
        delta: 0n,
        notes: "balanced",
      },
    });
    expect(r.id).toBeTruthy();
    expect(r.ledgerTotalUnits).toBe(100n);
    expect(r.delta).toBe(0n);
    await prisma.reconciliationLog.delete({ where: { id: r.id } });
  });

  it("ReconciliationLog accepts null delta + null onChainTotal (rpc-failure shape)", async () => {
    const r = await prisma.reconciliationLog.create({
      data: {
        ledgerTotalUnits: 50n,
        onChainTotalUnits: null,
        delta: null,
        notes: "rpc failure: simulated",
      },
    });
    expect(r.id).toBeTruthy();
    expect(r.delta).toBeNull();
    expect(r.onChainTotalUnits).toBeNull();
    await prisma.reconciliationLog.delete({ where: { id: r.id } });
  });
});
