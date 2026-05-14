"use client";

/**
 * Bet detail page — auth-protected.
 * Single-source via useBetDetail; BetActionsSection's internal useBetDetail
 * hits the same TanStack cache entry (one network request per load).
 */

import { use } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { BetDetail } from "@/components/bet-detail";
import { BetActionsSection } from "@/components/bets/bet-actions-section";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useBetDetail } from "@/hooks/use-bet-detail";

export default function BetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AuthGuard>
      <BetDetailContent id={id} />
    </AuthGuard>
  );
}

function BetDetailContent({ id }: { id: string }) {
  const { data: bet, isLoading, isError, error, refetch } = useBetDetail(id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load bet</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error instanceof Error ? error.message : "Unknown error"}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {bet && <BetDetail bet={bet} />}

      {bet && (
        <div className="mt-6">
          <BetActionsSection betId={id} />
        </div>
      )}
    </main>
  );
}
