import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { finalizeLedgerForBet } from "@/lib/settlement/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BETS_PER_RUN = 50;

/**
 * Cron: retry FAILED/PENDING ledger finalizations.
 * Runs every 5 minutes via vercel.json schedule.
 *
 * Picks bets where ledgerStatus IN (PENDING, FAILED) and
 * ledgerNextRetryAt is past. FAILED_TERMINAL bets are
 * skipped (require admin attention).
 *
 * Self-healing: failed bets get backoff via markLedgerFailed
 * in finalize.ts, so this cron naturally backs off retries.
 */
export async function GET(request: Request) {
  const h = await headers();
  const authHeader = h.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const candidates = await prisma.bet.findMany({
      where: {
        ledgerStatus: { in: ["PENDING", "FAILED"] },
        OR: [
          { ledgerNextRetryAt: null },
          { ledgerNextRetryAt: { lte: new Date() } },
        ],
      },
      select: { id: true, ledgerStatus: true, ledgerRetryCount: true },
      orderBy: { ledgerNextRetryAt: "asc" },
      take: MAX_BETS_PER_RUN,
    });

    let succeeded = 0;
    const failedIds: Array<{ betId: string; error: string }> = [];

    for (const bet of candidates) {
      try {
        const result = await finalizeLedgerForBet(bet.id, "cron-retry");
        if (result.success) {
          succeeded++;
        } else {
          failedIds.push({
            betId: bet.id,
            error: result.error ?? "unknown",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { betId: bet.id, err: msg },
          "cron-retry: unexpected per-bet failure",
        );
        failedIds.push({ betId: bet.id, error: msg });
      }
    }

    const durationMs = Date.now() - startedAt;

    logger.info(
      {
        processed: candidates.length,
        succeeded,
        failedCount: failedIds.length,
        durationMs,
      },
      "cron-retry: batch complete",
    );

    return NextResponse.json({
      ok: true,
      processed: candidates.length,
      succeeded,
      failedCount: failedIds.length,
      failedIds,
      durationMs,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "cron-retry: batch failed",
    );
    return NextResponse.json(
      { ok: false, error: "batch_failed" },
      { status: 500 },
    );
  }
}
