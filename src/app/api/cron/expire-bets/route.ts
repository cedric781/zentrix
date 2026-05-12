import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { expireOpenBet, autoVoidProposedBet } from "@/lib/bets/expire";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const startTime = Date.now();
  const authHeader = (await headers()).get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expected) {
    logger.warn("cron expire-bets: unauthorized access attempt");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let expiredCount = 0;
  let voidedCount = 0;
  const errors: string[] = [];

  try {
    const openBets = await prisma.bet.findMany({
      where: {
        status: "OPEN",
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
      take: 50,
      orderBy: { expiresAt: "asc" },
    });

    for (const bet of openBets) {
      try {
        await prisma.$transaction(async (tx) => {
          await expireOpenBet(bet.id, tx);
        });
        expiredCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`expireOpenBet(${bet.id}): ${msg}`);
        logger.warn("expireOpenBet error", { betId: bet.id, error: msg });
      }
    }

    const proposedBets = await prisma.bet.findMany({
      where: {
        status: "RESULT_PROPOSED",
        confirmDeadline: { lt: new Date() },
      },
      select: { id: true },
      take: 50,
      orderBy: { confirmDeadline: "asc" },
    });

    for (const bet of proposedBets) {
      try {
        await prisma.$transaction(async (tx) => {
          await autoVoidProposedBet(bet.id, tx);
        });
        voidedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`autoVoidProposedBet(${bet.id}): ${msg}`);
        logger.warn("autoVoidProposedBet error", { betId: bet.id, error: msg });
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info("cron expire-bets complete", {
      expired: expiredCount,
      voided: voidedCount,
      errors: errors.length,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      expired: expiredCount,
      voided: voidedCount,
      errors,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("cron expire-bets fatal error", { error: msg });
    return NextResponse.json(
      {
        ok: false,
        expired: expiredCount,
        voided: voidedCount,
        errors: [...errors, `Fatal: ${msg}`],
        durationMs: Date.now() - startTime,
      },
      { status: 500 },
    );
  }
}
