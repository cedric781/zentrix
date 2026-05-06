import "server-only";
import { Prisma } from "@prisma/client";
import type { TxClient } from "./accounts";
import { lockAccount } from "./accounts";

export interface LedgerLine {
  debitAccountId: string;
  creditAccountId: string;
  amountUnits: bigint;
  entryType: Prisma.LedgerEntryCreateInput["entryType"];
  note?: string;
  meta?: Prisma.InputJsonValue;
}

export interface RecordTransactionInput {
  tx: TxClient;
  idempotencyKey: string;
  description: string;
  initiatorUserId?: string;
  refType?: string;
  refId?: string;
  lines: LedgerLine[];
}

export class IdempotentReplayError extends Error {
  constructor(public existingTransactionId: string) {
    super(`Idempotency key already used; replayed transaction ${existingTransactionId}`);
    this.name = "IdempotentReplayError";
  }
}

export class UnbalancedLedgerError extends Error {
  constructor(public totalDebits: bigint, public totalCredits: bigint) {
    super(`Unbalanced ledger lines: debits=${totalDebits} credits=${totalCredits}`);
    this.name = "UnbalancedLedgerError";
  }
}

/**
 * Atomic write of a balanced set of ledger lines.
 *
 * Invariants (guaranteed at function exit OR not committed):
 * 1. SUM(debit amounts) === SUM(credit amounts) — refuses to commit otherwise.
 * 2. Idempotency: re-call with same key returns the existing tx (or throws
 *    IdempotentReplayError, depending on caller policy).
 * 3. Each touched FinancialAccount.balanceUnits is updated atomically while
 *    holding FOR UPDATE on that row (lockAccount).
 * 4. After-balance fields on each LedgerEntry reflect the post-transaction
 *    balance of debit/credit accounts.
 *
 * The function does NOT open its own transaction — caller passes `tx`.
 * Reason: callers often need to do DB work alongside the ledger write
 * (e.g. update Withdrawal.status). One transaction = one commit.
 */
export async function recordTransaction(input: RecordTransactionInput) {
  const { tx, idempotencyKey, description, initiatorUserId, refType, refId, lines } = input;

  if (lines.length === 0) {
    throw new Error("recordTransaction: must have at least one line");
  }

  // Idempotency check — DB-level via @unique. If duplicate, P2002 is thrown
  // by createMany or by the eventual transaction insert. We pre-check here
  // ONLY to short-circuit cheaply; the @unique constraint is the authority.
  const existing = await tx.ledgerTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return { transaction: existing, replayed: true as const };
  }

  // Balance check before any DB writes.
  let totalDebits = 0n;
  let totalCredits = 0n;
  for (const line of lines) {
    if (line.amountUnits <= 0n) {
      throw new Error(`recordTransaction: line amount must be > 0, got ${line.amountUnits}`);
    }
    if (line.debitAccountId === line.creditAccountId) {
      throw new Error("recordTransaction: debit and credit account must differ");
    }
    totalDebits += line.amountUnits;
    totalCredits += line.amountUnits;
  }

  // Collect the unique account IDs to lock (deterministic order — prevent deadlocks).
  const touched = new Set<string>();
  for (const l of lines) {
    touched.add(l.debitAccountId);
    touched.add(l.creditAccountId);
  }
  const sortedIds = [...touched].sort();

  // Lock each account in deterministic order. Read current balances.
  const balances = new Map<string, bigint>();
  for (const id of sortedIds) {
    const locked = await lockAccount(tx, id);
    balances.set(id, locked.balanceUnits);
  }

  // Apply each line: decrement debit, increment credit (in the in-memory map).
  // After-balance fields captured at moment of application.
  const entryRows: Prisma.LedgerEntryUncheckedCreateInput[] = [];
  for (const line of lines) {
    const debitBefore = balances.get(line.debitAccountId)!;
    const creditBefore = balances.get(line.creditAccountId)!;

    const debitAfter = debitBefore - line.amountUnits;
    const creditAfter = creditBefore + line.amountUnits;

    balances.set(line.debitAccountId, debitAfter);
    balances.set(line.creditAccountId, creditAfter);

    entryRows.push({
      transactionId: "", // filled after we create the LedgerTransaction below
      debitAccountId: line.debitAccountId,
      creditAccountId: line.creditAccountId,
      amountUnits: line.amountUnits,
      entryType: line.entryType,
      debitBalanceAfter: debitAfter,
      creditBalanceAfter: creditAfter,
      note: line.note ?? null,
      meta: line.meta ?? Prisma.JsonNull,
    });
  }

  // Sanity: re-verify balance.
  if (totalDebits !== totalCredits) {
    throw new UnbalancedLedgerError(totalDebits, totalCredits);
  }

  // Insert LedgerTransaction first.
  const ledgerTx = await tx.ledgerTransaction.create({
    data: {
      idempotencyKey,
      description,
      initiatorUserId,
      refType,
      refId,
      totalDebits,
      totalCredits,
      entryCount: lines.length,
      isBalanced: true,
    },
  });

  // Fill in transactionId on all entries and bulk-insert.
  for (const e of entryRows) e.transactionId = ledgerTx.id;
  await tx.ledgerEntry.createMany({ data: entryRows });

  // Persist the new balanceUnits on each touched FinancialAccount.
  // Using updateMany with WHERE id=... so we don't accidentally hit unrelated rows.
  for (const [accountId, newBalance] of balances) {
    await tx.financialAccount.update({
      where: { id: accountId },
      data: { balanceUnits: newBalance },
    });
  }

  return { transaction: ledgerTx, replayed: false as const };
}

// Re-export Prisma so consumers don't import it twice
