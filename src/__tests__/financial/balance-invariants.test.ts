import { describe, expect, it, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordTransaction, getUserAccount, getExternalAccount, ONE_USDC } from "@/lib/ledger";

describe("balance-invariants", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.ledgerTransaction.deleteMany();
    await prisma.financialAccount.deleteMany({ where: { accountType: "USER" } });
    await prisma.user.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it("FinancialAccount.balanceUnits == SUM(credits) - SUM(debits) over its entries", async () => {
    const user = await prisma.user.create({
      data: { privyId: `inv-${Date.now()}` },
    });

    // Three deposits of 1, 2, 3 USDC.
    for (let i = 1; i <= 3; i++) {
      await prisma.$transaction(async (tx) => {
        const userAcct = await getUserAccount(tx, user.id);
        const ext = await getExternalAccount(tx);
        await recordTransaction({
          tx,
          idempotencyKey: `dep-${user.id}-${i}`,
          description: `deposit ${i}`,
          initiatorUserId: user.id,
          lines: [
            {
              debitAccountId: ext.id,
              creditAccountId: userAcct.id,
              amountUnits: BigInt(i) * ONE_USDC,
              entryType: "DEPOSIT_CREDIT",
            },
          ],
        });
      }, { timeout: 30000, maxWait: 30000 });
    }

    const userAcct = await prisma.financialAccount.findFirst({
      where: { userId: user.id },
    });
    expect(userAcct).not.toBeNull();

    const credits = await prisma.ledgerEntry.aggregate({
      where: { creditAccountId: userAcct!.id },
      _sum: { amountUnits: true },
    });
    const debits = await prisma.ledgerEntry.aggregate({
      where: { debitAccountId: userAcct!.id },
      _sum: { amountUnits: true },
    });

    const derived = (credits._sum.amountUnits ?? 0n) - (debits._sum.amountUnits ?? 0n);
    expect(userAcct!.balanceUnits).toBe(derived);
    expect(userAcct!.balanceUnits).toBe(6n * ONE_USDC); // 1+2+3
  });
});
