import "server-only";
import { getSolanaConnection } from "@/lib/solana/connection";
import { parseSolanaAddress } from "@/lib/solana/address";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { creditDeposit } from "./credit";
import { logger } from "@/lib/logger";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

/**
 * Poll for USDC deposits to user embedded wallets.
 *
 * Strategy: for each user, fetch their USDC associated token account (ATA)
 * signature history since their last seen slot. For each new signature, parse
 * the USDC transfer amount and call creditDeposit.
 *
 * This is the SLOW path; webhooks handle the fast path. But this is the
 * source of truth — if Helius drops an event, this catches it within 1 min.
 *
 * To keep cost reasonable: only poll users active in the last 7 days.
 * Cap fetch at 100 sigs per user per run.
 */
export async function runDepositPoller(opts?: { limit?: number }): Promise<{
  usersScanned: number;
  newCredits: number;
  errors: number;
}> {
  const env = getEnv();
  const conn = getSolanaConnection();
  const usdcMint = parseSolanaAddress(env.USDC_MINT_ADDRESS);
  const limit = opts?.limit ?? 50;

  const recentUsers = await prisma.user.findMany({
    where: {
      embeddedWalletAddress: { not: null },
      updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  let newCredits = 0;
  let errors = 0;

  for (const user of recentUsers) {
    if (!user.embeddedWalletAddress) continue;
    try {
      const ownerPk = parseSolanaAddress(user.embeddedWalletAddress);
      const ata = getAssociatedTokenAddressSync(usdcMint, ownerPk, true);

      // Get last known signature we've credited for this user.
      const last = await prisma.deposit.findFirst({
        where: { userId: user.id, status: "CREDITED" },
        orderBy: { slot: "desc" },
        select: { slot: true, txSignature: true },
      });

      const sigs = await conn.getSignaturesForAddress(ata, {
        limit: 100,
        until: last?.txSignature, // stop at last credited
      });

      for (const sig of sigs) {
        if (sig.err) continue;
        // Fetch the parsed transaction to extract token transfer.
        const txDetail = await conn.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "finalized",
        });
        if (!txDetail) continue;

        // Walk instruction list for SPL transfers to our ATA.
        let logIndex = 0;
        const instructions = txDetail.transaction.message.instructions;
        for (const ix of instructions) {
          // We only handle parsed SPL token instructions
          if (
            "parsed" in ix &&
            ix.program === "spl-token" &&
            (ix.parsed as { type?: string }).type &&
            ["transfer", "transferChecked"].includes((ix.parsed as { type: string }).type)
          ) {
            const info = (ix.parsed as { info: Record<string, unknown> }).info;
            const dest = info.destination as string | undefined;
            if (dest !== ata.toBase58()) {
              logIndex++;
              continue;
            }

            // Amount: transferChecked has tokenAmount.amount (string of micro-units);
            // legacy transfer has amount (string).
            let amountStr: string | undefined;
            if (info.tokenAmount && typeof info.tokenAmount === "object") {
              amountStr = (info.tokenAmount as { amount?: string }).amount;
            } else if (typeof info.amount === "string") {
              amountStr = info.amount;
            }
            if (!amountStr) {
              logIndex++;
              continue;
            }
            const amountUnits = BigInt(amountStr);

            const outcome = await creditDeposit({
              userId: user.id,
              txSignature: sig.signature,
              logIndex,
              amountUnits,
              slot: BigInt(sig.slot),
            });
            if (outcome.kind === "credited") newCredits++;
            logIndex++;
          } else {
            logIndex++;
          }
        }
      }
    } catch (err) {
      errors++;
      logger.error(
        { userId: user.id, err: (err as Error).message },
        "poller error for user",
      );
    }
  }

  logger.info({ usersScanned: recentUsers.length, newCredits, errors }, "poller run done");
  return { usersScanned: recentUsers.length, newCredits, errors };
}
