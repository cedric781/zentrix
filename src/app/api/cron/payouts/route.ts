import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { processPayoutsBatch } from "@/lib/payouts/batch";

export const runtime = "nodejs";
// 60s — the ceiling that works on every Vercel plan (Hobby's hard cap; the rest
// of this app's routes also pin 60). transferUsdcOnChain blocks on
// confirmTransaction("confirmed") and a single leg can hit ~60-90s at blockhash
// expiry, so a run CAN be truncated mid-confirm. That is recoverable, not a
// double-pay: the sig is persisted only after the transfer returns, so the next
// run re-sends the SAME idempotencyKey (Privy dedupe). Raise to 300 only once
// the project is confirmed on Pro/Enterprise.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  }

  const h = await headers();
  const authHeader = h.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;

  const providedBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const stats = await processPayoutsBatch();
    const durationMs = Date.now() - startedAt;

    logger.info({ ...stats, durationMs }, "payouts cron complete");

    return NextResponse.json({
      ok: true,
      processed: stats.dispatchCandidates + stats.recoveryCandidates,
      ...stats,
      durationMs,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "payouts cron: batch failed",
    );
    return NextResponse.json({ error: "batch_failed" }, { status: 500 });
  }
}
