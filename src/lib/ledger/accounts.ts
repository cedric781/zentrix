import "server-only";
import type { Prisma } from "@prisma/client";

/** Type alias for a Prisma transaction client. */
export type TxClient = Prisma.TransactionClient;

/** Scope-key conventions — ALWAYS use these helpers, never inline strings. */
export const userScopeKey = (userId: string) => `user:${userId}`;
export const betScopeKey = (betId: string) => `bet:${betId}`;
export const disputeScopeKey = (disputeId: string) => `dispute:${disputeId}`;
export const TREASURY_SCOPE_KEY = "treasury";
export const EXTERNAL_SCOPE_KEY = "external";

/**
 * Get-or-create the user's USER FinancialAccount.
 * Idempotent. Called from inside a transaction.
 */
export async function getUserAccount(tx: TxClient, userId: string) {
  return tx.financialAccount.upsert({
    where: { scopeKey: userScopeKey(userId) },
    create: {
      accountType: "USER",
      scopeKey: userScopeKey(userId),
      userId,
    },
    update: {},
  });
}

/** Get the singleton TREASURY account. Throws if missing — must be seeded. */
export async function getTreasuryAccount(tx: TxClient) {
  const acct = await tx.financialAccount.findUnique({
    where: { scopeKey: TREASURY_SCOPE_KEY },
  });
  if (!acct) {
    throw new Error(
      "TREASURY account missing — run `pnpm prisma db seed`. " +
        "If you see this in production, the deploy is corrupt.",
    );
  }
  return acct;
}

/** Get the singleton EXTERNAL counter-account. */
export async function getExternalAccount(tx: TxClient) {
  const acct = await tx.financialAccount.findUnique({
    where: { scopeKey: EXTERNAL_SCOPE_KEY },
  });
  if (!acct) {
    throw new Error("EXTERNAL account missing — run `pnpm prisma db seed`.");
  }
  return acct;
}

/**
 * Acquire a row-level lock on a FinancialAccount.
 * MUST be called inside a `prisma.$transaction()`.
 *
 * Reference: LESSONS_FROM_WAGER.md R6 (FOR UPDATE patterns).
 *
 * Returns the locked row's current balanceUnits. Use this value for
 * balance checks — it is guaranteed to be consistent for the duration
 * of the surrounding transaction.
 */
export async function lockAccount(
  tx: TxClient,
  accountId: string,
): Promise<{ id: string; balanceUnits: bigint }> {
  // Prisma's $queryRaw returns rows; we ask for exactly one.
  const rows = await tx.$queryRaw<{ id: string; balance_units: bigint }[]>`
    SELECT id, balance_units FROM financial_accounts
    WHERE id = ${accountId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error(`lockAccount: expected 1 row, got ${rows.length} for id=${accountId}`);
  }
  return { id: rows[0].id, balanceUnits: BigInt(rows[0].balance_units) };
}
