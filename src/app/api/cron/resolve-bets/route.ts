import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { resolveBetsBatch } from "@/lib/external-results/resolve-service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const authHeader = (await headers()).get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    logger.warn("cron resolve-bets: bad auth");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await resolveBetsBatch();
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : "unknown" },
      "cron resolve-bets: batch failed",
    );
    return NextResponse.json({ ok: false, error: "batch_failed" }, { status: 500 });
  }
}
