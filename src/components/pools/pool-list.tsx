"use client";

/**
 * PoolList — public/mine infinite list with status filter.
 *
 * Tabs:
 *   - Explore (scope=public): OPEN/CLOSED/SETTLED across all users.
 *   - My Pools (scope=mine): caller's pools across all statuses.
 *
 * Status filter (All/Open/Closed/Settled) applies to the active tab.
 * Pagination is cursor-based; backend caps page size (max 50).
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PoolCard } from "./pool-card";
import { usePools } from "@/hooks/use-pools";
import type { PoolScope, PoolStatus } from "@/lib/api/pools";

type StatusFilter = PoolStatus | "ALL";

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "Closed", value: "CLOSED" },
  { label: "Settled", value: "SETTLED" },
];

export function PoolList() {
  const [scope, setScope] = useState<PoolScope>("public");
  const [status, setStatus] = useState<StatusFilter>("ALL");

  const query = usePools({
    scope,
    status: status === "ALL" ? undefined : status,
  });

  return (
    <div className="space-y-6">
      <Tabs value={scope} onValueChange={(v) => setScope(v as PoolScope)}>
        <TabsList>
          <TabsTrigger value="public">Explore</TabsTrigger>
          <TabsTrigger value="mine">My Pools</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={status === opt.value ? "default" : "outline"}
            onClick={() => setStatus(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {query.isLoading && <SkeletonGrid />}

      {query.isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load pools</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => query.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {query.data && (
        <>
          {query.data.pages.every((p) => p.items.length === 0) ? (
            <div className="space-y-2 rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm font-medium">
                {scope === "public"
                  ? "No public pools yet"
                  : "You haven't created any pools"}
              </p>
              <p className="text-xs text-muted-foreground">
                {scope === "public"
                  ? "Pools will appear here once creators publish them."
                  : "Pools you create will appear here."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {query.data.pages.flatMap((page) =>
                page.items.map((pool) => (
                  <PoolCard key={pool.id} pool={pool} />
                )),
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
                {query.isFetchingNextPage ? "Loading…" : "Load more"}
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
