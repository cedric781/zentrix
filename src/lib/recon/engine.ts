import "server-only";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { parseSolanaAddress } from "@/lib/solana/address";
import { getEnv } from "@/lib/env";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { logger } from "@/lib/logger";
import { tripCircuit } from "@/lib/circuit-breaker";
import { ONE_USDC } from "@/lib/money/units";

/**
 * Threshold for auto-tripping the withdrawals breaker. Currently hardcoded;
 * graduate to env var (e.g. RECON_DELTA_TRIP_USDC) once we see real prod
 * variance worth tuning to.
 */
const TRIP_THRESHOLD_UNITS = ONE_USDC; // 1 USDC in micro-units

export interface ReconResult {
  ledgerTotalUnits: bigint;
  onChainTotalUnits: bigint | null;
  delta: bigint | null;
  rpcOk: boolean;
  /** Users with positive ledger balance but no embedded wallet — excluded from on-chain sum. */
  excludedUserCount: number;
  excludedBalanceUnits: bigint;
}

/**
 * Compares ledger total user balance against on-chain USDC across all
 * users' embedded wallets. Writes a ReconciliationLog row.
 *
 * Expected: delta == 0. Non-zero means either:
 *   - A deposit hit chain but ledger missed it (poller will catch eventually)
 *   - A withdrawal was processed off-chain but ledger missed it (BUG)
 *   - On-chain transfer between users that bypassed our system (USER ACTION,
 *     usually fine — but worth knowing)
 *
 * If absolute delta > TRIP_THRESHOLD_UNITS (1 USDC), trip the `withdrawals`
 * circuit breaker as a conservative measure. Operator inspects, fixes,
 * manually closes via /api/admin/breakers.
 *
 * Graceful RPC handling: if Solana RPC fails, write a ReconciliationLog
 * row with null delta + an explanatory notes message and return
 * rpcOk=false. The breaker is NEVER tripped on RPC failure — otherwise
 * any RPC outage would take down withdrawals.
 *
 * Test-data nuance: users with positive ledger balance but null
 * embeddedWalletAddress are excluded from the on-chain sum (no wallet to
 * query). Their ledger balance still counts in ledgerTotal, inflating
 * delta. We log this count + sum so the operator can explain a false
 * positive. In production this scenario is essentially impossible — the
 * TODO #1 auth backfill populates wallets, and deposits require an
 * already-existing on-chain wallet to land.
 */
export async function runReconciliation(): Promise<ReconResult> {
  const env = getEnv();
  const conn = getSolanaConnection();

  // ── Ledger side ────────────────────────────────────────────────────────
  const userAggregate = await prisma.financialAccount.aggregate({
    where: { accountType: "USER" },
    _sum: { balanceUnits: true },
  });
  const ledgerTotal = userAggregate._sum.balanceUnits ?? 0n;

  // Observability for users that contribute to ledgerTotal but not onChainTotal.
  // Two separate queries (count + aggregate) keep the Prisma type complexity
  // low — nested-select on this relation crashed tsc on Windows in this repo.
  const excludedUserCount = await prisma.user.count({
    where: {
      embeddedWalletAddress: null,
      financialAccount: { balanceUnits: { gt: 0n } },
    },
  });
  // Use raw SQL to compute excluded balance — typed relation filter on
  // FinancialAccount.user crashes tsc on this Windows box.
  const excludedRows = await prisma.$queryRaw<{ sum: bigint | null }[]>`
    SELECT COALESCE(SUM(fa.balance_units), 0)::bigint AS sum
    FROM financial_accounts fa
    JOIN users u ON u.id = fa.user_id
    WHERE fa.account_type = 'USER'
      AND fa.balance_units > 0
      AND u.embedded_wallet_address IS NULL
  `;
  const excludedBalanceUnits = excludedRows[0]?.sum ?? 0n;
  if (excludedUserCount > 0) {
    logger.warn(
      {
        count: excludedUserCount,
        excludedBalanceUnits: excludedBalanceUnits.toString(),
      },
      "recon: users with positive balance but no embedded wallet (excluded from on-chain total)",
    );
  }

  // ── On-chain side ──────────────────────────────────────────────────────
  const users = await prisma.user.findMany({
    where: { embeddedWalletAddress: { not: null } },
    select: { embeddedWalletAddress: true },
  });

  const usdcMint = parseSolanaAddress(env.USDC_MINT_ADDRESS);
  let onChainTotal = 0n;
  let rpcErrorMessage = "";

  const BATCH = 100;
  try {
    for (let i = 0; i < users.length; i += BATCH) {
      const slice = users.slice(i, i + BATCH);
      const atas = slice.map((u) => {
        const owner = parseSolanaAddress(u.embeddedWalletAddress!);
        return getAssociatedTokenAddressSync(usdcMint, owner, true);
      });
      const accounts = await conn.getMultipleParsedAccounts(atas, {
        commitment: "finalized",
      });
      for (const acct of accounts.value) {
        if (!acct) continue;
        const parsed = (acct.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } })
          .parsed;
        const amountStr = parsed?.info?.tokenAmount?.amount;
        if (amountStr) {
          onChainTotal += BigInt(amountStr);
        }
      }
    }
  } catch (err) {
    rpcErrorMessage = (err as Error).message;
    logger.error(
      { err: rpcErrorMessage },
      "recon: RPC failure — log written with null delta, breaker NOT tripped",
    );
  }

  // ── RPC failure path: log + bail without tripping ─────────────────────
  if (rpcErrorMessage) {
    await prisma.reconciliationLog.create({
      data: {
        ledgerTotalUnits: ledgerTotal,
        onChainTotalUnits: null,
        delta: null,
        notes: `rpc failure: ${rpcErrorMessage}`.slice(0, 500),
      },
    });
    return {
      ledgerTotalUnits: ledgerTotal,
      onChainTotalUnits: null,
      delta: null,
      rpcOk: false,
      excludedUserCount,
      excludedBalanceUnits,
    };
  }

  // ── Happy path: write log, possibly trip breaker ──────────────────────
  const delta = ledgerTotal - onChainTotal;

  await prisma.reconciliationLog.create({
    data: {
      ledgerTotalUnits: ledgerTotal,
      onChainTotalUnits: onChainTotal,
      delta,
      notes:
        delta === 0n
          ? "balanced"
          : `delta=${delta} (positive=ledger>chain, possibly missed deposit; negative=chain>ledger, possibly bug)`,
    },
  });

  logger.info(
    {
      ledgerTotalUnits: ledgerTotal.toString(),
      onChainTotalUnits: onChainTotal.toString(),
      delta: delta.toString(),
      excludedUserCount,
      excludedBalanceUnits: excludedBalanceUnits.toString(),
    },
    "recon snapshot",
  );

  if (delta < -TRIP_THRESHOLD_UNITS || delta > TRIP_THRESHOLD_UNITS) {
    await tripCircuit(
      "withdrawals",
      `recon delta out of band: ${delta.toString()} micro-units`,
      "recon-engine",
    );
    logger.error(
      { delta: delta.toString() },
      "RECON DELTA OUT OF BAND — withdrawals tripped",
    );
  }

  return {
    ledgerTotalUnits: ledgerTotal,
    onChainTotalUnits: onChainTotal,
    delta,
    rpcOk: true,
    excludedUserCount,
    excludedBalanceUnits,
  };
}
