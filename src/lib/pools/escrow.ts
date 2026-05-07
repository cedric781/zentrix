import type { FinancialAccount, Prisma } from "@prisma/client";

/**
 * Get or create the BET_ESCROW account for a given pool.
 *
 * Idempotent across concurrent first-bet attempts: if a parallel caller
 * wins the unique-constraint race on `scopeKey`, the P2002 path falls back
 * to a re-read and returns the row that the winner created.
 *
 * IMPORTANT: this helper participates in a transaction owned by the caller
 * — it must be invoked with a `Prisma.TransactionClient` (`tx`), not the
 * global `prisma` client. PROMPT_10's `placeBet` wraps balance debit + entry
 * insert + escrow credit in one transaction; this helper joins that scope.
 *
 * Note: PROMPT_09 itself never invokes this function. It is defined here so
 * that PROMPT_10 has a stable target for the lazy escrow-creation path.
 *
 * @param tx     A Prisma transaction client.
 * @param poolId The id of the pool whose escrow account is needed.
 * @returns      The existing or newly created BET_ESCROW FinancialAccount.
 */
export async function getOrCreatePoolEscrowAccount(
  tx: Prisma.TransactionClient,
  poolId: string,
): Promise<FinancialAccount> {
  const scopeKey = `pool:${poolId}`;

  const existing = await tx.financialAccount.findUnique({ where: { scopeKey } });
  if (existing) return existing;

  try {
    return await tx.financialAccount.create({
      data: {
        accountType: "BET_ESCROW",
        scopeKey,
        balanceUnits: 0n,
        label: `Pool escrow ${poolId}`,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const after = await tx.financialAccount.findUnique({ where: { scopeKey } });
      if (after) return after;
    }
    throw err;
  }
}
