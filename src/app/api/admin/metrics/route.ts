import { prisma } from "@/lib/prisma";
import { requireAdmin, AdminAuthError } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prometheus exposition format — text/plain.
 *
 * Counters reset to 0 on startup; we recompute from DB on each scrape.
 * For a small platform this is fine. At scale, switch to a long-lived
 * counter with periodic dumps to a TSDB.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return new Response("unauthorized", { status: 401 });
    }
    throw err;
  }

  const [
    userCount,
    depositsCredited,
    depositsFailed,
    withdrawalsQueued,
    withdrawalsConfirmed,
    withdrawalsFailed,
    breakers,
    latestRecon,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.deposit.count({ where: { status: "CREDITED" } }),
    prisma.deposit.count({ where: { status: "FAILED" } }),
    prisma.withdrawal.count({ where: { status: "QUEUED" } }),
    prisma.withdrawal.count({ where: { status: "CONFIRMED" } }),
    prisma.withdrawal.count({ where: { status: "FAILED" } }),
    prisma.circuitBreaker.findMany(),
    prisma.reconciliationLog.findFirst({ orderBy: { checkedAt: "desc" } }),
  ]);

  const lines: string[] = [
    "# HELP zentrix_users_total Number of registered users",
    "# TYPE zentrix_users_total gauge",
    `zentrix_users_total ${userCount}`,
    "",
    "# HELP zentrix_deposits_total Deposits by terminal status",
    "# TYPE zentrix_deposits_total counter",
    `zentrix_deposits_total{status="credited"} ${depositsCredited}`,
    `zentrix_deposits_total{status="failed"} ${depositsFailed}`,
    "",
    "# HELP zentrix_withdrawals_total Withdrawals by status",
    "# TYPE zentrix_withdrawals_total gauge",
    `zentrix_withdrawals_total{status="queued"} ${withdrawalsQueued}`,
    `zentrix_withdrawals_total{status="confirmed"} ${withdrawalsConfirmed}`,
    `zentrix_withdrawals_total{status="failed"} ${withdrawalsFailed}`,
    "",
    "# HELP zentrix_circuit_breaker_open 1 if breaker is open, 0 otherwise",
    "# TYPE zentrix_circuit_breaker_open gauge",
    ...breakers.map(
      (b) => `zentrix_circuit_breaker_open{key="${b.key}"} ${b.isOpen ? 1 : 0}`,
    ),
    "",
    "# HELP zentrix_reconciliation_delta_units Latest ledger-vs-onchain delta in micro-USDC",
    "# TYPE zentrix_reconciliation_delta_units gauge",
    `zentrix_reconciliation_delta_units ${latestRecon?.delta?.toString() ?? 0}`,
    "",
    "# HELP zentrix_reconciliation_age_seconds Age of latest recon snapshot",
    "# TYPE zentrix_reconciliation_age_seconds gauge",
    `zentrix_reconciliation_age_seconds ${
      latestRecon ? Math.floor((Date.now() - latestRecon.checkedAt.getTime()) / 1000) : -1
    }`,
  ];

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  });
}
