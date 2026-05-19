import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { creditDeposit } from "@/lib/deposits/credit";
import { logger } from "@/lib/logger";
import { HeliusEventArraySchema } from "@/lib/solana/helius-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // sec — prevent Vercel 10s default timeout on batch events

export async function POST(req: Request) {
  // 1. Verify Helius auth header BEFORE doing any work.
  const env = getEnv();
  const authHeader = (await headers()).get("authorization");
  if (authHeader !== env.HELIUS_WEBHOOK_SECRET) {
    logger.warn({ headerLen: authHeader?.length ?? 0 }, "helius webhook auth failed");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse body strictly.
  const raw = await req.json().catch(() => null);
  const parsed = HeliusEventArraySchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "helius webhook bad body");
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  // 3. For each event, find every TokenTransfer where:
  //    - mint == USDC_MINT_ADDRESS
  //    - toUserAccount matches one of our users' embeddedWalletAddress
  //    Then call creditDeposit().
  const usdcMint = env.USDC_MINT_ADDRESS;

  const results: Array<{ sig: string; logIndex: number; outcome: string }> = [];

  for (const event of parsed.data) {
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

      // Look up user by embedded wallet address.
      const user = await prisma.user.findUnique({
        where: { embeddedWalletAddress: tt.toUserAccount },
      });
      if (!user) {
        // Not one of ours — ignore quietly.
        logIndex++;
        continue;
      }

      // Use rawTokenAmount when present (string preserves precision).
      let amountUnits: bigint;
      if (tt.rawTokenAmount) {
        amountUnits = BigInt(tt.rawTokenAmount.tokenAmount);
      } else {
        // Fallback: convert float to BigInt with care. This branch SHOULD never
        // hit for USDC since Helius always provides rawTokenAmount, but we
        // fail loud rather than silently mis-credit.
        logger.error(
          { sig: event.signature },
          "helius event missing rawTokenAmount — REJECTED",
        );
        return NextResponse.json({ error: "missing_raw_amount" }, { status: 400 });
      }

      try {
        const outcome = await creditDeposit({
          userId: user.id,
          txSignature: event.signature,
          logIndex,
          amountUnits,
          slot: BigInt(event.slot),
        });
        results.push({ sig: event.signature, logIndex, outcome: outcome.kind });
      } catch (err) {
        logger.error(
          { err: (err as Error).message, sig: event.signature, logIndex },
          "creditDeposit failed",
        );
        // Do not fail the whole webhook — Helius will retry; better to ack the rest.
        results.push({ sig: event.signature, logIndex, outcome: "error" });
      }
      logIndex++;
    }
  }

  return NextResponse.json({ ok: true, results });
}
