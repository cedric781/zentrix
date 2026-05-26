import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { processCreatorDeposit } from "@/lib/escrow-deposits/processor";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BETS_PER_RUN = 10;

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
    const candidates = await prisma.bet.findMany({
      where: {
        escrowDepositStatus: { in: ["PENDING_CREATOR", "FAILED"] },
        status: "PENDING_ESCROW",
        OR: [
          { escrowDepositNextRetryAt: null },
          { escrowDepositNextRetryAt: { lte: new Date() } },
        ],
      },
      select: {
        id: true,
        createdById: true,
        stakeUnits: true,
        escrowDepositRetryCount: true,
        escrowDepositCreatorTxSig: true,
      },
      take: MAX_BETS_PER_RUN,
      orderBy: { escrowCreatorAttemptedAt: "asc" },
    });

    let confirmed = 0;
    let failed = 0;
    let terminal = 0;
    let skipped = 0;

    for (const bet of candidates) {
      try {
        const result = await processCreatorDeposit(bet);
        switch (result.outcome) {
          case "confirmed": confirmed++; break;
          case "failed": failed++; break;
          case "failed_terminal": terminal++; break;
          case "skipped": skipped++; break;
        }
      } catch (err) {
        logger.error(
          { betId: bet.id, err: err instanceof Error ? err.message : String(err) },
          "escrow-deposits cron: unhandled per-bet error",
        );
        failed++;
      }
    }

    const durationMs = Date.now() - startedAt;

    logger.info(
      { processed: candidates.length, confirmed, failed, terminal, skipped, durationMs },
      "escrow-deposits cron complete",
    );

    return NextResponse.json({
      ok: true,
      processed: candidates.length,
      confirmed,
      failed,
      terminal,
      skipped,
      durationMs,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "escrow-deposits cron: batch failed",
    );
    return NextResponse.json({ ok: false, error: "batch_failed" }, { status: 500 });
  }
}
