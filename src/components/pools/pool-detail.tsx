"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CountdownTimer } from "@/components/bets/countdown-timer";
import { PoolStatusBadge } from "./pool-status-badge";
import { MatchList } from "./match-list";
import { OwnerActions } from "./owner-actions";
import type { PoolStatus, PoolWithMatchesSerialized } from "@/lib/api/pools";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PoolDetail({ pool }: { pool: PoolWithMatchesSerialized }) {
  const status = pool.status as PoolStatus;
  const closesAt = new Date(pool.bettingClosesAt);
  const showCountdown = status === "OPEN" && closesAt.getTime() > Date.now();
  const matchCount = pool.matches.length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Link
        href="/pools"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to pools
      </Link>

      <header className="mb-8 grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <PoolStatusBadge status={status} />
            <span className="text-xs font-mono text-muted-foreground">
              #{pool.id.slice(0, 8)}
            </span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {pool.title}
          </h1>
          {pool.description && (
            <p className="text-sm text-muted-foreground max-w-2xl">
              {pool.description}
            </p>
          )}
        </div>

        {showCountdown && (
          <CountdownTimer
            targetDate={pool.bettingClosesAt}
            label="Closes in"
            className="md:items-end"
          />
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <OwnerActions pool={pool} />
          <MatchList matches={pool.matches} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Pool info
              </h2>

              <div className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-right">
                    {formatDate(pool.createdAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Closes</span>
                  <span className="text-right">
                    {formatDateTime(pool.bettingClosesAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Matches</span>
                  <span className="text-right tabular-nums">{matchCount}</span>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-xs text-muted-foreground mb-1">Creator</p>
                <p className="text-xs font-mono break-all">
                  {pool.createdById.slice(0, 12)}…
                </p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
