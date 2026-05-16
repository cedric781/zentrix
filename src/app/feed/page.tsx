"use client";

import { usePrivy } from "@privy-io/react-auth";
import { AuthGuard } from "@/components/auth-guard";
import { BetList } from "@/components/bet-list";
import { WalletBalanceCard } from "@/components/wallet/wallet-balance-card";

export default function FeedPage() {
  return (
    <AuthGuard>
      <FeedContent />
    </AuthGuard>
  );
}

function FeedContent() {
  const { user } = usePrivy();

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Bets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.email?.address ?? user?.wallet?.address ?? "Signed in"}
        </p>
      </div>

      <div className="mb-8">
        <WalletBalanceCard />
      </div>

      <BetList />
    </main>
  );
}
