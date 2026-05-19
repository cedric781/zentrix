"use client";

import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useDeposits } from "@/hooks/use-deposits";
import { formatUsdc } from "@/lib/money/units";
import type { DepositSerialized } from "@/lib/api/types";

type DepositStatus = "PENDING" | "CREDITED" | "FAILED";

const STATUS_LABELS: Record<DepositStatus, string> = {
  PENDING: "Pending",
  CREDITED: "Credited",
  FAILED: "Failed",
};

const STATUS_VARIANTS: Record<
  DepositStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  CREDITED: "default",
  FAILED: "destructive",
};

function formatUsdcAmount(unitsStr: string): string {
  try {
    return formatUsdc(BigInt(unitsStr));
  } catch {
    return unitsStr;
  }
}

function truncateSignature(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}…${sig.slice(-6)}`;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function DepositHistoryList() {
  const { data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useDeposits();

  const allDeposits: DepositSerialized[] =
    data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent deposits</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load deposits: {error instanceof Error ? error.message : "Unknown error"}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !isError && allDeposits.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No deposits yet. Send USDC on Solana to your wallet address to get started.
          </p>
        )}

        {allDeposits.length > 0 && (
          <ul className="divide-y">
            {allDeposits.map((d) => (
              <li
                key={d.id}
                className="py-3 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {formatUsdcAmount(d.amountUnits ?? "0")} USDC
                    </span>
                    <Badge variant={STATUS_VARIANTS[d.status as DepositStatus]}>
                      {STATUS_LABELS[d.status as DepositStatus]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <a
                      href={`https://solscan.io/tx/${d.txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono hover:text-foreground inline-flex items-center gap-1"
                      title={d.txSignature}
                    >
                      {truncateSignature(d.txSignature)}
                      <ExternalLink size={10} />
                    </a>
                    <span>•</span>
                    <span>{formatRelativeTime(d.createdAt)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasNextPage && (
          <div className="pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full"
            >
              {isFetchingNextPage ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
