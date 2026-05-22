"use client";

/**
 * Bet detail page — auth-protected.
 * BetDetail internalizes both P26 action surfaces (BetActionsSection for
 * ACTIVE+ states; embedded ActionPanel for OPEN's accept-bet flow).
 */

import { use } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { BetDetail } from "@/components/bets/bet-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useBetDetail } from "@/hooks/use-bet-detail";

export default function BetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <AuthGuard>
      <BetDetailContent id={id} />
    </AuthGuard>
  );
}

function BetDetailContent({ id }: { id: string }) {
  const { data: bet, isLoading, isError, error, refetch } = useBetDetail(id);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load bet</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              {error instanceof Error ? error.message : "Unknown error"}
            </span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!bet) return null;

  return <BetDetail bet={bet} />;
}
