import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const startTime = Date.now();
  const authHeader = (await headers()).get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expected) {
    logger.warn("cron cleanup-stale: unauthorized access attempt");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const inviteResult = await prisma.betInvite.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        usedAt: null,
      },
    });

    const keyResult = await prisma.idempotencyKey.deleteMany({
      where: {
        expiresAt: { not: null, lt: new Date() },
      },
    });

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        invites: inviteResult.count,
        keys: keyResult.count,
        durationMs,
      },
      "cron cleanup-stale complete",
    );

    return NextResponse.json({
      ok: true,
      invitesDeleted: inviteResult.count,
      keysDeleted: keyResult.count,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, "cron cleanup-stale error");
    return NextResponse.json(
      {
        ok: false,
        invitesDeleted: 0,
        keysDeleted: 0,
        durationMs: Date.now() - startTime,
      },
      { status: 500 },
    );
  }
}
