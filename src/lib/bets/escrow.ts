import "server-only";
import { Prisma } from "@prisma/client";
import { betScopeKey, type TxClient } from "@/lib/ledger";

export async function getOrCreateBetEscrowAccount(tx: TxClient, betId: string) {
  const scopeKey = betScopeKey(betId);
  const existing = await tx.financialAccount.findUnique({ where: { scopeKey } });
  if (existing) return existing;
  try {
    return await tx.financialAccount.create({
      data: {
        accountType: "BET_ESCROW",
        scopeKey,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const after = await tx.financialAccount.findUnique({ where: { scopeKey } });
      if (after) return after;
    }
    throw e;
  }
}
