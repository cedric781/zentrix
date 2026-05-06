import "server-only";
import { prisma } from "@/lib/prisma";
import { recordTransaction, getUserAccount, getExternalAccount } from "@/lib/ledger";
import { logger } from "@/lib/logger";

export interface CreditDepositInput {
  userId: string;
  txSignature: string;
  logIndex: number;
  amountUnits: bigint;
  slot: bigint;
}

export type CreditResult =
  | { kind: "credited"; depositId: string; ledgerTxId: string }
  | { kind: "already_credited"; depositId: string }
  | { kind: "skipped_zero" }
  | { kind: "skipped_disabled" };

/**
 * Idempotently credit an on-chain USDC deposit.
 *
 * Called from BOTH:
 *   - Helius webhook handler (fast path)
 *   - Cron poller (truth path — catches webhook misses)
 *
 * The (txSignature, logIndex) uniqueness on the Deposit row + the ledger
 * idempotency key make double-crediting impossible regardless of caller.
 */
export async function creditDeposit(input: CreditDepositInput): Promise<CreditResult> {
  const { userId, txSignature, logIndex, amountUnits, slot } = input;

  if (process.env.DEPOSITS_DISABLED === "true") {
    logger.warn({ userId, txSignature }, "deposit skipped: DEPOSITS_DISABLED");
    return { kind: "skipped_disabled" };
  }

  if (amountUnits <= 0n) {
    logger.info({ userId, txSignature, logIndex }, "deposit skipped: zero amount");
    return { kind: "skipped_zero" };
  }

  const idempotencyKey = `deposit:${txSignature}:${logIndex}`;

  return prisma.$transaction(async (tx) => {
    // Check existing Deposit row (DB-level uniqueness on tx_signature + log_index)
    const existing = await tx.deposit.findUnique({
      where: {
        // unique constraint name from schema
        txSignature_logIndex: { txSignature, logIndex },
      },
    });

    if (existing && existing.status === "CREDITED") {
      return { kind: "already_credited", depositId: existing.id };
    }

    // Create or update the Deposit row to PENDING (or upsert if missed)
    const deposit = await tx.deposit.upsert({
      where: {
        txSignature_logIndex: { txSignature, logIndex },
      },
      create: {
        userId,
        txSignature,
        logIndex,
        amountUnits,
        slot,
        status: "PENDING",
      },
      update: {
        // If we re-discover a PENDING row (e.g. retry), no-op the data fields
        amountUnits, // re-affirm in case original was wrong; idempotent if identical
      },
    });

    // Run the ledger credit. Idempotent on idempotencyKey.
    const userAcct = await getUserAccount(tx, userId);
    const ext = await getExternalAccount(tx);

    const result = await recordTransaction({
      tx,
      idempotencyKey,
      description: `Deposit ${txSignature.slice(0, 8)}…`,
      initiatorUserId: userId,
      refType: "deposit",
      refId: deposit.id,
      lines: [
        {
          debitAccountId: ext.id,
          creditAccountId: userAcct.id,
          amountUnits,
          entryType: "DEPOSIT_CREDIT",
          note: `tx=${txSignature} log=${logIndex}`,
        },
      ],
    });

    // Mark deposit CREDITED with FK to the ledger transaction.
    await tx.deposit.update({
      where: { id: deposit.id },
      data: {
        status: "CREDITED",
        ledgerTxId: result.transaction.id,
        creditedAt: new Date(),
      },
    });

    logger.info(
      {
        userId,
        depositId: deposit.id,
        ledgerTxId: result.transaction.id,
        amountUnits: amountUnits.toString(),
        replayed: result.replayed,
      },
      "deposit credited",
    );

    return { kind: "credited", depositId: deposit.id, ledgerTxId: result.transaction.id };
  });
}
