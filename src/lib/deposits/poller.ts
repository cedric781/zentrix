import "server-only";
import { getSolanaConnection } from "@/lib/solana/connection";
import { parseSolanaAddress } from "@/lib/solana/address";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { creditDeposit } from "./credit";
import { logger } from "@/lib/logger";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { fetchEnhancedTransactions } from "@/lib/solana/helius-enhanced";
import { type HeliusEvent } from "@/lib/solana/helius-types";
import { parseUsdcAmountUnits } from "./parse-transfer";

/**
 * Poll for USDC deposits to user embedded wallets.
 *
 * Strategy: for each user, fetch their USDC associated token account (ATA)
 * signature history since their last seen slot. Batch-fetch enhanced
 * transaction data via Helius enhanced API, then iterate tokenTransfers
 * IDENTICALLY to the webhook handler. This guarantees identical logIndex
 * values across both paths — critical for deposit idempotency on the
 * (txSignature, logIndex) unique constraint.
 *
 * This is the SLOW path; webhooks handle the fast path. But this is the
 * source of truth — if Helius drops an event, this catches it within 1 min.
 *
 * To keep cost reasonable: only poll users active in the last 7 days.
 * Cap fetch at 100 sigs per user per run (also fits Helius enhanced API
 * batch limit of 100 signatures per call).
 */
export async function runDepositPoller(opts?: { limit?: number }): Promise<{
  usersScanned: number;
  newCredits: number;
  errors: number;
}> {
  const env = getEnv();
  const conn = getSolanaConnection();
  const usdcMint = env.USDC_MINT_ADDRESS;
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
      const ata = getAssociatedTokenAddressSync(
        parseSolanaAddress(usdcMint),
        parseSolanaAddress(user.embeddedWalletAddress),
      );

      const last = await prisma.deposit.findFirst({
        where: { userId: user.id, status: "CREDITED" },
        orderBy: { slot: "desc" },
        select: { slot: true, txSignature: true },
      });

      const sigs = await conn.getSignaturesForAddress(ata, {
        limit: 100,
        until: last?.txSignature,
      });

      const successfulSignatures = sigs
        .filter((s) => !s.err)
        .map((s) => s.signature);
      if (successfulSignatures.length === 0) {
        continue;
      }

      let events: HeliusEvent[];
      try {
        events = await fetchEnhancedTransactions(successfulSignatures);
      } catch (err) {
        logger.error(
          { err, userId: user.id, count: successfulSignatures.length },
          "deposit-poller: enhanced API fetch failed",
        );
        errors++;
        continue;
      }

      for (const event of events) {
        let logIndex = 0;
        for (const tt of event.tokenTransfers) {
          if (tt.mint !== usdcMint) {
            logIndex++;
            continue;
          }
          if (!tt.toUserAccount) {
            logIndex++;
            continue;
          }
          if (tt.toUserAccount !== user.embeddedWalletAddress) {
            logIndex++;
            continue;
          }

          const amountUnits = parseUsdcAmountUnits(tt);
          if (amountUnits === null) {
            logger.warn(
              {
                signature: event.signature,
                logIndex,
                userId: user.id,
                hasRaw: Boolean(tt.rawTokenAmount),
                tokenAmount: tt.tokenAmount,
                rawTokenAmount: tt.rawTokenAmount,
              },
              "deposit-poller: skipping transfer with unparseable amount",
            );
            logIndex++;
            continue;
          }

          try {
            await creditDeposit({
              userId: user.id,
              txSignature: event.signature,
              logIndex,
              amountUnits,
              slot: BigInt(event.slot),
            });
            newCredits++;
          } catch (err) {
            logger.error(
              { err, userId: user.id, signature: event.signature, logIndex },
              "deposit-poller: creditDeposit failed",
            );
            errors++;
          }

          logIndex++;
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
