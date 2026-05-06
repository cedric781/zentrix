import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { creditDeposit } from "@/lib/deposits/credit";
import { ONE_USDC } from "@/lib/ledger";

describe("creditDeposit", () => {
  beforeEach(async () => {
    await prisma.deposit.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.ledgerTransaction.deleteMany();
    await prisma.financialAccount.deleteMany({ where: { accountType: "USER" } });
    await prisma.user.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it("credits a fresh deposit and creates ledger transaction", async () => {
    const user = await prisma.user.create({ data: { privyId: "test1" } });
    await prisma.financialAccount.create({
      data: { accountType: "USER", scopeKey: `user:${user.id}`, userId: user.id },
    });

    const r = await creditDeposit({
      userId: user.id,
      txSignature: "5xY...abc",
      logIndex: 0,
      amountUnits: 10n * ONE_USDC,
      slot: 1000n,
    });

    expect(r.kind).toBe("credited");
    if (r.kind !== "credited") return; // type narrowing

    const dep = await prisma.deposit.findUnique({ where: { id: r.depositId } });
    expect(dep?.status).toBe("CREDITED");
    expect(dep?.ledgerTxId).toBe(r.ledgerTxId);

    const acct = await prisma.financialAccount.findFirst({ where: { userId: user.id } });
    expect(acct?.balanceUnits).toBe(10n * ONE_USDC);
  });

  it("is idempotent on (txSignature, logIndex)", async () => {
    const user = await prisma.user.create({ data: { privyId: "test2" } });
    await prisma.financialAccount.create({
      data: { accountType: "USER", scopeKey: `user:${user.id}`, userId: user.id },
    });

    const r1 = await creditDeposit({
      userId: user.id,
      txSignature: "samesig",
      logIndex: 0,
      amountUnits: 5n * ONE_USDC,
      slot: 100n,
    });
    const r2 = await creditDeposit({
      userId: user.id,
      txSignature: "samesig",
      logIndex: 0,
      amountUnits: 5n * ONE_USDC,
      slot: 100n,
    });

    expect(r1.kind).toBe("credited");
    expect(r2.kind).toBe("already_credited");

    const acct = await prisma.financialAccount.findFirst({ where: { userId: user.id } });
    expect(acct?.balanceUnits).toBe(5n * ONE_USDC); // ONLY ONCE
  });

  it("treats different logIndex on same tx as different deposits", async () => {
    const user = await prisma.user.create({ data: { privyId: "test3" } });
    await prisma.financialAccount.create({
      data: { accountType: "USER", scopeKey: `user:${user.id}`, userId: user.id },
    });

    await creditDeposit({
      userId: user.id, txSignature: "multi", logIndex: 0, amountUnits: ONE_USDC, slot: 1n,
    });
    await creditDeposit({
      userId: user.id, txSignature: "multi", logIndex: 1, amountUnits: 2n * ONE_USDC, slot: 1n,
    });

    const acct = await prisma.financialAccount.findFirst({ where: { userId: user.id } });
    expect(acct?.balanceUnits).toBe(3n * ONE_USDC);
  });

  it("respects DEPOSITS_DISABLED kill switch", async () => {
    process.env.DEPOSITS_DISABLED = "true";
    const user = await prisma.user.create({ data: { privyId: "test4" } });
    await prisma.financialAccount.create({
      data: { accountType: "USER", scopeKey: `user:${user.id}`, userId: user.id },
    });

    const r = await creditDeposit({
      userId: user.id, txSignature: "killed", logIndex: 0, amountUnits: ONE_USDC, slot: 1n,
    });
    expect(r.kind).toBe("skipped_disabled");
    process.env.DEPOSITS_DISABLED = "false";
  });
});
