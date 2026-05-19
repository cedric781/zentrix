import "server-only";
import { prisma } from "@/lib/prisma";
import { recordTransaction, getUserAccount, getExternalAccount } from "@/lib/ledger";
import { logger } from "@/lib/logger";
import { isCircuitOpen } from "@/lib/circuit-breaker";

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
  | { kind: "skipped_disabled" }
  | { kind: "skipped_breaker" };

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

  if (await isCircuitOpen("deposits")) {
    logger.warn({ userId, txSignature }, "deposit skipped: circuit breaker open");
    return { kind: "skipped_breaker" };
  }

  if (amountUnits <= 0n) {
    logger.info({ userId, txSignature, logIndex }, "deposit skipped: zero amount");
    return { kind: "skipped_zero" };
  }

  // Defense-in-depth: cap max deposit amount. If hit, signals upstream parser
  // bug or compromised webhook secret crediting arbitrary amounts.
  // Threshold: 1M USDC in micro-units (USDC has 6 decimals).
  const MAX_DEPOSIT_MICRO_UNITS = 1_000_000_000_000n; // 1M USDC
  if (amountUnits > MAX_DEPOSIT_MICRO_UNITS) {
    logger.error(
      {
        userId,
        txSignature,
        logIndex,
        amountUnits: amountUnits.toString(),
        cap: MAX_DEPOSIT_MICRO_UNITS.toString(),
      },
      "deposit rejected: amount exceeds max cap",
    );
    throw new Error(
      `Deposit amount ${amountUnits} exceeds cap ${MAX_DEPOSIT_MICRO_UNITS}`,
    );
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

    // If an existing PENDING row's amount doesn't match incoming, that's a
    // serious parser bug or upstream data corruption — fail loud rather than
    // silently overwriting with the new value.
    if (existing && existing.amountUnits !== amountUnits) {
      logger.error(
        {
          userId,
          txSignature,
          logIndex,
          existingAmount: existing.amountUnits.toString(),
          incomingAmount: amountUnits.toString(),
          depositId: existing.id,
        },
        "deposit upsert amount mismatch — parser bug or data corruption",
      );
      throw new Error(
        `Deposit amount mismatch on (${txSignature}, ${logIndex}): existing=${existing.amountUnits} incoming=${amountUnits}`,
      );
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
