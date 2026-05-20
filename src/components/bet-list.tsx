"use client";

/**
 * BetList — marketplace + my-bets infinite list.
 *
 * Tabs:
 *   - Explore (scope=all): public marketplace, defaults to OPEN+ACTIVE
 *     unless status filter is supplied.
 *   - My Bets (scope=mine): caller's own bets (createdBy OR opponent).
 *
 * Filters apply to the active tab. Pagination is cursor-based; backend
 * caps page size, see parseListQuery.
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MatchCard } from "@/components/feed/match-card";
import { useBets } from "@/hooks/use-bets";
import { CategoryTabs } from "@/components/categories/category-tabs";
import { CATEGORY_CONFIG, type CategorySlug } from "@/lib/categories/config";
import type { BetStatus } from "@/lib/api/bets";

type Scope = "all" | "mine";
type StatusFilter = BetStatus | "ALL";

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "Active", value: "ACTIVE" },
  { label: "Settled", value: "SETTLED" },
];

export function BetList() {
  const [tab, setTab] = useState<Scope>("all");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [selectedCategory, setSelectedCategory] = useState<
    CategorySlug | "all"
  >("all");

  const categoryFilter =
    selectedCategory === "all"
      ? undefined
      : CATEGORY_CONFIG[selectedCategory].dbValue;

  const query = useBets({
    scope: tab,
    status: status === "ALL" ? undefined : status,
    category: categoryFilter,
  });

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Scope)}>
        <TabsList>
          <TabsTrigger value="all">Explore</TabsTrigger>
          <TabsTrigger value="mine">My Bets</TabsTrigger>
        </TabsList>
      </Tabs>

      <CategoryTabs
        value={selectedCategory}
        onChange={setSelectedCategory}
      />

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
          <AlertTitle>Couldn&apos;t load bets</AlertTitle>
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
                {tab === "all"
                  ? "No bets match your filters"
                  : "No bets yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {tab === "all"
                  ? "Try a different category or status."
                  : "Bets you create or accept will appear here."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {query.data.pages.flatMap((page) =>
                page.items.map((bet) => <MatchCard key={bet.id} bet={bet} />),
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
