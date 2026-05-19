"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Copy, LogOut } from "lucide-react";
import { toast } from "sonner";

import { AuthGuard } from "@/components/auth-guard";
import { WalletBalanceCard } from "@/components/wallet/wallet-balance-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/use-current-user";

export default function MePage() {
  return (
    <AuthGuard>
      <MeContent />
    </AuthGuard>
  );
}

function MeContent() {
  const { logout } = usePrivy();
  const { data: user, isLoading } = useCurrentUser();

  const email = user?.email ?? null;
  const walletAddress = user?.embeddedWalletAddress ?? null;

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy address");
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error("logout failed", err);
      toast.error("Sign out failed");
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your wallet, view your balance, and sign out.
        </p>
      </div>

      <WalletBalanceCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Email
            </div>
            {isLoading ? (
              <Skeleton className="h-5 w-48" />
            ) : email ? (
              <div className="text-sm">{email}</div>
            ) : (
              <div className="text-sm text-muted-foreground">No email linked</div>
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Wallet address
            </div>
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : walletAddress ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                <code
                  className="flex-1 font-mono text-xs break-all"
                  title={walletAddress}
                >
                  {walletAddress}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyAddress}
                  aria-label="Copy wallet address"
                >
                  <Copy size={14} />
                </Button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No wallet</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            className="w-full sm:w-auto gap-2"
          >
            <LogOut size={14} />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
