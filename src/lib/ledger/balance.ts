import "server-only";
import { prisma } from "@/lib/prisma";
import { userScopeKey } from "./accounts";

export interface UserBalance {
  /** Cached balance from FinancialAccount.balanceUnits — updated by recordTransaction. */
  availableUnits: bigint;
  /** Account ID for further queries (e.g. recent ledger history). */
  accountId: string;
}

/**
 * Read-only balance lookup. Does NOT lock the account row.
 * For balance-check-then-debit flows, callers must use lockAccount() inside
 * their own transaction — never read here, then write elsewhere. (R6)
 */
export async function getUserBalance(userId: string): Promise<UserBalance> {
  const acct = await prisma.financialAccount.findUnique({
    where: { scopeKey: userScopeKey(userId) },
  });
  if (!acct) {
    throw new Error(`getUserBalance: no account for user ${userId} (provisioning bug?)`);
  }
  return { availableUnits: acct.balanceUnits, accountId: acct.id };
}
