"use client";

import { AuthGuard } from "@/components/auth-guard";
import { AmbientGlow } from "@/components/landing/ambient-glow";
import { BetList } from "@/components/bet-list";
import { WalletBalanceCard } from "@/components/wallet/wallet-balance-card";

export default function FeedPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen landing-bg-gradient relative">
        <AmbientGlow />
        <main className="relative z-10 mx-auto max-w-7xl px-4 md:px-10 py-12">
          <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[var(--brand)] font-mono text-[11px] uppercase tracking-widest mb-2 block">
                Live Markets
              </span>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight font-display">
                Active bets
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Discover open and live bets across all categories.
              </p>
            </div>
          </header>

          <div className="mb-8">
            <WalletBalanceCard />
          </div>

          <BetList />
        </main>
      </div>
    </AuthGuard>
  );
}
