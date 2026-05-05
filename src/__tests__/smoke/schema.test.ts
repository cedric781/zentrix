import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

describe("schema smoke test", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("treasury account exists from seed", async () => {
    const treasury = await prisma.financialAccount.findUnique({
      where: { scopeKey: "treasury" },
    });
    expect(treasury).not.toBeNull();
    expect(treasury!.accountType).toBe("TREASURY");
  });

  it("external account exists from seed", async () => {
    const ext = await prisma.financialAccount.findUnique({
      where: { scopeKey: "external" },
    });
    expect(ext).not.toBeNull();
    expect(ext!.accountType).toBe("EXTERNAL");
  });

  it("BigInt money columns work", async () => {
    const treasury = await prisma.financialAccount.findUnique({
      where: { scopeKey: "treasury" },
    });
    expect(typeof treasury!.balanceUnits).toBe("bigint");
    expect(treasury!.balanceUnits).toBe(0n);
  });
});