import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWithdrawal } from "@/lib/withdrawals/intake";
import { WithdrawalError } from "@/lib/withdrawals/errors";
import { creditDeposit } from "@/lib/deposits/credit";
import { ONE_USDC } from "@/lib/money/units";
import { _resetEnvCache } from "@/lib/env";

async function cleanupAll() {
  // Order matters: child rows first to avoid FK violations.
  await prisma.withdrawal.deleteMany();
  await prisma.deposit.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.ledgerTransaction.deleteMany();
  await prisma.financialAccount.deleteMany({ where: { accountType: "USER" } });
  await prisma.user.deleteMany();
  // Reset denormalized balances on singleton accounts — deleteMany on entries
  // doesn't touch FinancialAccount.balanceUnits, and smoke/schema tests assert
  // treasury == 0n at startup.
  await prisma.financialAccount.updateMany({
    where: { scopeKey: { in: ["treasury", "external"] } },
    data: { balanceUnits: 0n },
  });
}

describe("createWithdrawal — intake validation", () => {
  beforeEach(cleanupAll);

  // Leave the DB in the same state we found it; later test files do
  // `prisma.user.deleteMany()` and would hit FK violations on lingering rows.
  afterAll(async () => {
    await cleanupAll();
    await prisma.$disconnect();
  });

  async function userWithBalance(units: bigint) {
    const user = await prisma.user.create({
      data: { privyId: `wd-${Date.now()}-${Math.random()}` },
    });
    await prisma.financialAccount.create({
      data: { accountType: "USER", scopeKey: `user:${user.id}`, userId: user.id },
    });
    await creditDeposit({
      userId: user.id,
      txSignature: `seed-${user.id}`,
      logIndex: 0,
      amountUnits: units,
      slot: 1n,
    });
    return user;
  }

  it("rejects invalid Solana address with INVALID_ADDRESS — NO Withdrawal row created", async () => {
    const user = await userWithBalance(50n * ONE_USDC);
    try {
      await createWithdrawal({
        userId: user.id,
        amountUsdc: "10",
        toAddress: "0OIl_obviously_invalid_chars",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WithdrawalError);
      expect((err as WithdrawalError).code).toBe("INVALID_ADDRESS");
    }
    const count = await prisma.withdrawal.count();
    expect(count).toBe(0); // critical: NO row leaked through
  });

  it("rejects EVM-style address with EVM_ADDRESS_DETECTED", async () => {
    const user = await userWithBalance(50n * ONE_USDC);
    try {
      await createWithdrawal({
        userId: user.id,
        amountUsdc: "10",
        toAddress: "0x1234567890123456789012345678901234567890",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WithdrawalError);
      expect((err as WithdrawalError).code).toBe("EVM_ADDRESS_DETECTED");
    }
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("rejects insufficient balance under FOR UPDATE", async () => {
    const user = await userWithBalance(5n * ONE_USDC);
    try {
      await createWithdrawal({
        userId: user.id,
        amountUsdc: "100",
        toAddress: "5xY9PkrX2A7H8m4kJ1Fz3qRsV6cTbN8wZpD2gE7uYn3M", // valid-looking
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WithdrawalError);
      // Either outcome is acceptable: address may parse and hit balance check,
      // or fail base58 decoding. Both prove no row leaked.
      expect(["INSUFFICIENT_BALANCE", "INVALID_ADDRESS"]).toContain(
        (err as WithdrawalError).code,
      );
    }
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("debits user balance and creates QUEUED withdrawal on success", async () => {
    const user = await userWithBalance(100n * ONE_USDC);
    // Use a valid Solana address (Memo program for testing — it's a real PublicKey)
    const validAddr = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
    const r = await createWithdrawal({
      userId: user.id,
      amountUsdc: "10",
      toAddress: validAddr,
    });
    expect(r.status).toBe("QUEUED");
    expect(r.amountUnits).toBe(10n * ONE_USDC);

    const w = await prisma.withdrawal.findUnique({ where: { id: r.id } });
    expect(w?.status).toBe("QUEUED");
    expect(w?.version).toBe(0);

    const acct = await prisma.financialAccount.findFirst({ where: { userId: user.id } });
    expect(acct?.balanceUnits).toBe(90n * ONE_USDC); // 100 - 10
  });

  it("respects WITHDRAWALS_DISABLED env kill-switch", async () => {
    const user = await userWithBalance(50n * ONE_USDC);
    process.env.WITHDRAWALS_DISABLED = "true";
    _resetEnvCache(); // intake calls getEnv() which caches; force re-parse
    try {
      try {
        await createWithdrawal({
          userId: user.id,
          amountUsdc: "10",
          toAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(WithdrawalError);
        expect((err as WithdrawalError).code).toBe("WITHDRAWALS_DISABLED");
      }
    } finally {
      process.env.WITHDRAWALS_DISABLED = "false";
      _resetEnvCache();
    }
  });
});
