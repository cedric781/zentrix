import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { executePendingWithdrawals } from "@/lib/withdrawals/executor";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = (await headers()).get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    logger.warn("cron execute-withdrawals: bad auth");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await executePendingWithdrawals({ limit: 10 });
  return NextResponse.json({ ok: true, count: results.length, results });
}
