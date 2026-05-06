import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { runDepositPoller } from "@/lib/deposits/poller";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60; // sec

/**
 * Vercel Cron-triggered. Runs every minute.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` header.
 */
export async function GET() {
  const authHeader = (await headers()).get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (authHeader !== expected) {
    logger.warn("cron poll-deposits: bad auth");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runDepositPoller();
  return NextResponse.json({ ok: true, ...result });
}
