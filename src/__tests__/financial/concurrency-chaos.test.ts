import { describe, expect, it, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordTransaction, getUserAccount, getExternalAccount, ONE_USDC } from "@/lib/ledger";

describe("concurrency-chaos", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.ledgerTransaction.deleteMany();
    await prisma.financialAccount.deleteMany({ where: { accountType: "USER" } });
    await prisma.user.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it("10 parallel calls with the same idempotencyKey produce exactly one LedgerTransaction", async () => {
    const user = await prisma.user.create({ data: { privyId: `chaos-${Date.now()}` } });
    await prisma.$transaction(async (tx) => { await getUserAccount(tx, user.id); }, { timeout: 30000, maxWait: 30000 });
    const idempotencyKey = `chaos-key-${user.id}`;

    const tasks = Array.from({ length: 10 }, () =>
      prisma.$transaction(async (tx) => {
        const userAcct = await getUserAccount(tx, user.id);
        const ext = await getExternalAccount(tx);
        try {
          return await recordTransaction({
            tx,
            idempotencyKey,
            description: "chaos deposit",
            initiatorUserId: user.id,
            lines: [
              {
                debitAccountId: ext.id,
                creditAccountId: userAcct.id,
                amountUnits: ONE_USDC,
                entryType: "DEPOSIT_CREDIT",
              },
            ],
          });
        } catch (err) {
          // Race winner inserts the row first; losers throw P2002.
          // recordTransaction's pre-check returns "replayed" if it sees the existing row,
          // but if it hasn't committed yet, P2002 is the result. Both outcomes are correct.
          return { errored: true, name: (err as Error).name };
        }
      }, { timeout: 30000, maxWait: 30000 }),
    );

    const results = await Promise.all(tasks);
    const txs = await prisma.ledgerTransaction.findMany({ where: { idempotencyKey } });

    expect(txs.length).toBe(1);

    // Among results: at least one fresh insert OR replay; remaining are either replays or P2002.
    const userAcct = await prisma.financialAccount.findFirst({ where: { userId: user.id } });
    expect(userAcct!.balanceUnits).toBe(ONE_USDC); // ONLY ONE deposit applied
  });

  it("10 parallel different deposits all succeed and balances sum correctly", async () => {
    const user = await prisma.user.create({ data: { privyId: `chaos2-${Date.now()}` } });
    await prisma.$transaction(async (tx) => { await getUserAccount(tx, user.id); }, { timeout: 30000, maxWait: 30000 });

    const tasks = Array.from({ length: 10 }, (_, i) =>
      prisma.$transaction(async (tx) => {
        const userAcct = await getUserAccount(tx, user.id);
        const ext = await getExternalAccount(tx);
        await recordTransaction({
          tx,
          idempotencyKey: `chaos2-${user.id}-${i}`,
          description: `chaos2 deposit ${i}`,
          initiatorUserId: user.id,
          lines: [
            {
              debitAccountId: ext.id,
              creditAccountId: userAcct.id,
              amountUnits: ONE_USDC,
              entryType: "DEPOSIT_CREDIT",
            },
          ],
        });
      }, { timeout: 30000, maxWait: 30000 }),
    );

    await Promise.all(tasks);

    const userAcct = await prisma.financialAccount.findFirst({ where: { userId: user.id } });
    expect(userAcct!.balanceUnits).toBe(10n * ONE_USDC);

    const txs = await prisma.ledgerTransaction.findMany({ where: { initiatorUserId: user.id } });
    expect(txs.length).toBe(10);
  });
});
