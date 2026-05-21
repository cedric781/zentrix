import "server-only";
import { prisma } from "@/lib/prisma";
import { parseSolanaAddress, InvalidSolanaAddressError } from "@/lib/solana/address";
import { parseUsdc } from "@/lib/money/units";
import {
  recordTransaction,
  getUserAccount,
  getExternalAccount,
  getTreasuryAccount,
  lockAccount,
  type LedgerLine,
} from "@/lib/ledger";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isCircuitOpen } from "@/lib/circuit-breaker";
import { getPrivyServerClient } from "@/lib/privy/server";
import { WithdrawalError } from "./errors";
import { HARDCODED_WITHDRAWALS_DISABLED } from "./kill-switch-hardcode";
import { calculateWithdrawalFee } from "./fee";

export interface CreateWithdrawalInput {
  userId: string;
  /** Decimal string e.g. "10.5" */
  amountUsdc: string;
  /** Free-form input; will be validated with parseSolanaAddress */
  toAddress: string;
}

export interface CreateWithdrawalResult {
  id: string;
  amountUnits: bigint;
  feeUnits: bigint;
  netUnits: bigint;
  status: "QUEUED";
}

/**
 * Validate, debit, and queue a withdrawal — atomically.
 *
 * Steps (in order — DO NOT REORDER):
 * 1. Kill-switch check (env + hardcoded). Throws WITHDRAWALS_DISABLED.
 * 2. Address validation via parseSolanaAddress. Throws INVALID_ADDRESS — NO DB row.
 *    This is the fix for the WITHDRAWAL_POST_MORTEM "Non-base58 character" bug.
 * 3. EVM-shape address detection (starts with 0x) — separate error code so the
 *    UI can show a friendlier message.
 * 4. Amount parsing via parseUsdc. Throws INVALID_AMOUNT — NO DB row.
 * 5. Min-amount check. Throws AMOUNT_BELOW_MIN — NO DB row.
 * 6. Atomic in transaction:
 *    a. lockAccount(user) — FOR UPDATE
 *    b. balance check
 *    c. recordTransaction with WITHDRAWAL_DEBIT line (user → external) +
 *       FEE_COLLECTION line (user → treasury) if fee > 0
 *    d. INSERT Withdrawal row with status=QUEUED, ledgerTxId set, version=0
 */
export async function createWithdrawal(
  input: CreateWithdrawalInput,
): Promise<CreateWithdrawalResult> {
  const env = getEnv();

  // ── Step 1: Kill switches ─────────────────────────────────────────────
  // Layered defense: hardcoded fallback (R8) | env operator-toggle | circuit
  // breaker (operational lever). All three converge on WITHDRAWALS_DISABLED
  // so the API surface is uniform.
  if (env.WITHDRAWALS_DISABLED || HARDCODED_WITHDRAWALS_DISABLED) {
    throw new WithdrawalError(
      "WITHDRAWALS_DISABLED",
      "Withdrawals are temporarily disabled. Please try again later.",
      503,
    );
  }
  if (await isCircuitOpen("withdrawals")) {
    throw new WithdrawalError(
      "WITHDRAWALS_DISABLED",
      "Withdrawals are temporarily paused (circuit breaker open).",
      503,
    );
  }

  // ── Step 1b: Fresh delegation check via Privy SDK ─────────────────────
  // Source of truth is Privy, NOT the User.walletDelegatedAt DB column —
  // that column is a cache updated by /api/wallet/delegation-status and
  // can be stale by seconds in the "user just delegated, withdraws now"
  // race. Costs one extra API call per intake; acceptable for a flow
  // that already does several DB roundtrips.
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { privyId: true },
  });
  if (!user) {
    throw new WithdrawalError("INVALID_AMOUNT", "User not found", 400);
  }
  const privy = getPrivyServerClient();
  let privyUser;
  try {
    privyUser = await privy.getUserById(user.privyId);
  } catch (err) {
    logger.error(
      { err: (err as Error).message, userId: input.userId },
      "intake: Privy getUserById failed",
    );
    throw new WithdrawalError(
      "WALLET_NOT_DELEGATED",
      "Could not verify wallet authorization. Please retry.",
      503,
    );
  }
  const solWallet = privyUser?.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      "chainType" in a &&
      a.chainType === "solana" &&
      "walletClientType" in a &&
      a.walletClientType === "privy",
  ) as { delegated?: boolean } | undefined;
  if (!solWallet?.delegated) {
    throw new WithdrawalError(
      "WALLET_NOT_DELEGATED",
      "Please enable withdrawals in the portfolio page first.",
      400,
    );
  }

  // ── Step 2: Address — VALIDATE BEFORE ANY DB WORK (R7) ────────────────
  const trimmed = input.toAddress.replace(/[\s\n\r\t]/g, "");
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    throw new WithdrawalError(
      "EVM_ADDRESS_DETECTED",
      "That looks like an Ethereum address. We're on Solana — please paste a Solana wallet address.",
      400,
    );
  }
  let _validatedPubkey;
  try {
    _validatedPubkey = parseSolanaAddress(trimmed);
  } catch (err) {
    if (err instanceof InvalidSolanaAddressError) {
      throw new WithdrawalError(
        "INVALID_ADDRESS",
        `Invalid Solana address: ${err.reason}`,
        400,
      );
    }
    throw err;
  }

  // ── Step 3: Amount ─────────────────────────────────────────────────────
  let amountUnits: bigint;
  try {
    amountUnits = parseUsdc(input.amountUsdc);
  } catch (err) {
    throw new WithdrawalError(
      "INVALID_AMOUNT",
      `Invalid amount: ${(err as Error).message}`,
      400,
    );
  }

  if (amountUnits <= 0n) {
    throw new WithdrawalError("INVALID_AMOUNT", "Amount must be positive", 400);
  }

  const minUnits = parseUsdc(env.WITHDRAWAL_MIN_USDC);
  if (amountUnits < minUnits) {
    throw new WithdrawalError(
      "AMOUNT_BELOW_MIN",
      `Minimum withdrawal is ${env.WITHDRAWAL_MIN_USDC} USDC`,
      400,
    );
  }

  const feeUnits = calculateWithdrawalFee(amountUnits);
  const netUnits = amountUnits - feeUnits;
  if (netUnits <= 0n) {
    throw new WithdrawalError(
      "AMOUNT_BELOW_MIN",
      "Amount too small after fee — increase amount",
      400,
    );
  }

  // ── Step 4: Atomic DB work ────────────────────────────────────────────
  return prisma.$transaction(async (tx) => {
    const userAcct = await getUserAccount(tx, input.userId);
    const ext = await getExternalAccount(tx);
    const treasury = await getTreasuryAccount(tx);

    // Lock + balance check
    const locked = await lockAccount(tx, userAcct.id);
    if (locked.balanceUnits < amountUnits) {
      throw new WithdrawalError(
        "INSUFFICIENT_BALANCE",
        `Insufficient balance: have ${locked.balanceUnits}, need ${amountUnits} (incl. fee)`,
        400,
      );
    }

    // Pre-create the Withdrawal id so we can reference it in idempotencyKey.
    const withdrawalId = crypto.randomUUID();
    const idempotencyKey = `withdrawal:${withdrawalId}`;

    // Build ledger lines:
    //   user → external (net amount that goes off-chain)
    //   user → treasury (fee, optional)
    const lines: LedgerLine[] = [
      {
        debitAccountId: userAcct.id,
        creditAccountId: ext.id,
        amountUnits: netUnits,
        entryType: "WITHDRAWAL_DEBIT",
        note: `Withdrawal ${withdrawalId} (net)`,
      },
    ];
    if (feeUnits > 0n) {
      lines.push({
        debitAccountId: userAcct.id,
        creditAccountId: treasury.id,
        amountUnits: feeUnits,
        entryType: "FEE_COLLECTION",
        note: `Withdrawal ${withdrawalId} fee`,
      });
    }

    const ledger = await recordTransaction({
      tx,
      idempotencyKey,
      description: `Withdrawal ${withdrawalId}`,
      initiatorUserId: input.userId,
      refType: "withdrawal",
      refId: withdrawalId,
      lines,
    });

    const w = await tx.withdrawal.create({
      data: {
        id: withdrawalId,
        userId: input.userId,
        toAddress: trimmed,
        amountUnits,
        feeUnits,
        status: "QUEUED",
        ledgerTxId: ledger.transaction.id,
        version: 0,
      },
    });

    logger.info(
      {
        withdrawalId: w.id,
        userId: input.userId,
        amountUnits: amountUnits.toString(),
        feeUnits: feeUnits.toString(),
        netUnits: netUnits.toString(),
        toAddress: trimmed,
      },
      "withdrawal queued",
    );

    return {
      id: w.id,
      amountUnits,
      feeUnits,
      netUnits,
      status: "QUEUED" as const,
    };
  });
}
