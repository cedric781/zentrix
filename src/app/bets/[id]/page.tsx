"use client";

/**
 * Bet detail page — auth-protected.
 * Fetches single bet via getBet, delegates rendering to BetDetail.
 */

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { AuthGuard } from "@/components/auth-guard";
import { BetDetail } from "@/components/bet-detail";
import { BetActionsSection } from "@/components/bets/bet-actions-section";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getBet } from "@/lib/api/bets";

export default function BetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AuthGuard>
      <BetDetailContent id={id} />
    </AuthGuard>
  );
}

function BetDetailContent({ id }: { id: string }) {
  const { getAccessToken } = usePrivy();

  const query = useQuery({
    queryKey: ["bet", id],
    queryFn: async ({ signal }) => {
      const token = await getAccessToken();
      return getBet(id, { token: token ?? undefined, signal });
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      {query.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load bet</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{query.error instanceof Error ? query.error.message : "Unknown error"}</span>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {query.data && <BetDetail bet={query.data} />}

      {query.data && (
        <div className="mt-6">
          <BetActionsSection betId={id} />
        </div>
      )}
    </main>
  );
}
