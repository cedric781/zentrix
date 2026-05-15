"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Copy, Wallet } from "lucide-react";
import { toast } from "sonner";
import { usePrivy } from "@privy-io/react-auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsdc } from "@/lib/money/units";
import { useBalance } from "@/hooks/use-balance";
import { DepositModal } from "./deposit-modal";
import { WithdrawModal } from "./withdraw-modal";

const BRAND_BLUE = "#2563EB";

function formatUsdcDisplay(unitsStr: string): string {
  const full = formatUsdc(BigInt(unitsStr));
  const [whole, frac = ""] = full.split(".");
  const trimmed = frac.replace(/0+$/, "");
  const padded = trimmed.padEnd(2, "0");
  return `${whole}.${padded}`;
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletBalanceCard() {
  const { user } = usePrivy();
  const { data, isLoading, error, refetch, isRefetching } = useBalance();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const walletAddress = user?.wallet?.address ?? null;

  return (
    <>
    <Card data-slot="wallet-balance-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Wallet
            className="h-4 w-4"
            style={{ color: BRAND_BLUE }}
            aria-hidden
          />
          Balance
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <Skeleton className="h-8 w-32" />
        ) : error ? (
          <BalanceError onRetry={() => refetch()} isRetrying={isRefetching} />
        ) : data ? (
          (() => {
            // bigToStr returns string | null defensively; in practice the
            // schema default is 0 so null shouldn't occur — fall back to 0.
            const display = formatUsdcDisplay(data.balanceUnits ?? "0");
            return (
              <div
                className="font-mono text-2xl font-bold tabular-nums"
                aria-label={`Balance ${display} USDC`}
              >
                {display}{" "}
                <span className="text-sm font-medium text-muted-foreground">
                  USDC
                </span>
              </div>
            );
          })()
        ) : null}

        {walletAddress ? (
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-xs text-muted-foreground"
              title={walletAddress}
            >
              {truncateAddress(walletAddress)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:text-[var(--brand-blue)]"
              style={{ ["--brand-blue" as string]: BRAND_BLUE }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(walletAddress);
                  toast.success("Address copied");
                } catch {
                  toast.error("Couldn't copy address");
                }
              }}
              aria-label="Copy wallet address"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="gap-2"
            onClick={() => setDepositOpen(true)}
          >
            <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
            Deposit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setWithdrawOpen(true)}
          >
            <ArrowUpFromLine className="h-4 w-4" aria-hidden="true" />
            Withdraw
          </Button>
        </div>
      </CardContent>
    </Card>
    <DepositModal open={depositOpen} onOpenChange={setDepositOpen} />
    <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} />
    </>
  );
}

function BalanceError({
  onRetry,
  isRetrying,
}: {
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-destructive">Couldn’t load balance</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
      >
        {isRetrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
