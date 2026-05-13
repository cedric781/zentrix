"use client";

import { usePrivy } from "@privy-io/react-auth";
import { AuthGuard } from "@/components/auth-guard";
import { BetList } from "@/components/bet-list";
import { Button } from "@/components/ui/button";

export default function FeedPage() {
  return (
    <AuthGuard>
      <FeedContent />
    </AuthGuard>
  );
}

function FeedContent() {
  const { user, logout } = usePrivy();

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Bets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.email?.address ?? user?.wallet?.address ?? "Signed in"}
          </p>
        </div>
        <Button onClick={() => logout()} variant="outline" size="sm">
          Sign out
        </Button>
      </div>

      <BetList />
    </main>
  );
}
