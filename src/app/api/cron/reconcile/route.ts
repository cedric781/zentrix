import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { runReconciliation } from "@/lib/recon/engine";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron-triggered. Runs every 15 minutes.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Recon is read-mostly + a single ReconciliationLog insert. The expensive
 * part is the on-chain RPC batch — runReconciliation() handles RPC failure
 * gracefully (writes a null-delta log row, does NOT trip the breaker).
 */
export async function GET() {
  const auth = (await headers()).get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    logger.warn("cron reconcile: bad auth");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const r = await runReconciliation();
  return NextResponse.json({
    ok: r.rpcOk,
    ledgerTotalUnits: r.ledgerTotalUnits.toString(),
    onChainTotalUnits: r.onChainTotalUnits?.toString() ?? null,
    delta: r.delta?.toString() ?? null,
    excludedUserCount: r.excludedUserCount,
    excludedBalanceUnits: r.excludedBalanceUnits.toString(),
  });
}