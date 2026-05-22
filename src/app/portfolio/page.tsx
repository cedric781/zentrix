"use client";

import { Inbox } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AmbientGlow } from "@/components/landing/ambient-glow";
import { WalletBalanceCard } from "@/components/wallet/wallet-balance-card";
import { MetricCard } from "@/components/portfolio/metric-card";
import { ActiveBetsTable } from "@/components/portfolio/active-bets-table";
import { useBets } from "@/hooks/use-bets";
import type { BetStatus } from "@/lib/api/bets";

const TERMINAL_STATES: BetStatus[] = ["SETTLED", "CANCELLED", "EXPIRED", "VOID"];

export default function PortfolioPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen landing-bg-gradient relative">
        <AmbientGlow />
        <main className="relative z-10 mx-auto max-w-7xl px-4 md:px-10 py-12">
          <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[var(--brand)] font-mono text-[11px] uppercase tracking-widest mb-2 block">
                Portfolio
              </span>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight font-display">
                Your positions
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Active bets and account balance overview.
              </p>
            </div>
          </header>

          <PortfolioMetrics />

          <div className="mt-8">
            <ActiveBetsTable />
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}

function PortfolioMetrics() {
  const { data } = useBets({ scope: "mine" });

  const allBets = data?.pages?.flatMap((p) => p.items) ?? [];
  const activeCount = allBets.filter(
    (b) => !TERMINAL_STATES.includes(b.status as BetStatus),
  ).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <WalletBalanceCard />

      <MetricCard
        label="Active Positions"
        value={String(activeCount)}
        icon={Inbox}
        hint={
          activeCount === 0
            ? "No open bets"
            : `${activeCount} bet${activeCount === 1 ? "" : "s"} awaiting resolution`
        }
      />
    </div>
  );
}
