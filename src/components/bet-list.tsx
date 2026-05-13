"use client";

/**
 * BetList — infinite list of caller's bets with status filter.
 *
 * Notes:
 *   - GET /api/bets is auth-required and pre-filtered to current user server-side.
 *     No "all bets" view exists yet.
 *   - Pagination shape: { items, nextCursor }. hasMore = nextCursor !== null.
 *   - "Load more" button (accessible) instead of infinite scroll.
 */

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BetCard } from "@/components/bet-card";
import { listBets } from "@/lib/api/bets";
import type { BetStatus } from "@/lib/api/bets";

type StatusFilter = BetStatus | "ALL";

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "Active", value: "ACTIVE" },
  { label: "Settled", value: "SETTLED" },
];

export function BetList() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const { getAccessToken } = usePrivy();

  const status = statusFilter === "ALL" ? undefined : statusFilter;

  const query = useInfiniteQuery({
    queryKey: ["bets", { status }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const token = await getAccessToken();
      return listBets(
        { cursor: pageParam, status, take: 20 },
        { token: token ?? undefined, signal },
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={statusFilter === opt.value ? "default" : "outline"}
            onClick={() => setStatusFilter(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {query.isLoading && <SkeletonGrid />}

      {query.isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load bets</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{query.error instanceof Error ? query.error.message : "Unknown error"}</span>
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {query.data && (
        <>
          {query.data.pages.every((p) => p.items.length === 0) ? (
            <div className="rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm text-muted-foreground">
                No bets yet. Bets you create or accept will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {query.data.pages.flatMap((page) =>
                page.items.map((bet) => <BetCard key={bet.id} bet={bet} />),
              )}
            </div>
          )}

          {query.hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? "Loading\u2026" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  );
}
