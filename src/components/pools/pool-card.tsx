"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CountdownTimer } from "@/components/bets/countdown-timer";
import { PoolStatusBadge } from "./pool-status-badge";
import type { PoolStatus } from "@/lib/api/pools";
import type { PoolSerialized } from "@/lib/api/types";

export function PoolCard({ pool }: { pool: PoolSerialized }) {
  const status = pool.status as PoolStatus;
  const closesAt = new Date(pool.bettingClosesAt);
  const showCountdown = status === "OPEN" && closesAt.getTime() > Date.now();

  return (
    <Link href={`/pools/${pool.id}`} className="block group">
      <article className="glass-panel rounded-2xl p-5 border border-[var(--outline-variant)]/40 hover:border-[var(--brand)]/40 transition-all">
        <header className="flex items-start justify-between mb-4 gap-2">
          <PoolStatusBadge status={status} />
          {showCountdown && (
            <CountdownTimer
              targetDate={pool.bettingClosesAt}
              label="Closes in"
            />
          )}
        </header>

        <h3 className="font-display text-lg font-bold tracking-tight text-foreground mb-2 line-clamp-1">
          {pool.title}
        </h3>

        {pool.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
            {pool.description}
          </p>
        )}

        <footer className="flex items-center justify-between pt-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Closes{" "}
            {closesAt.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--brand)] font-mono text-xs uppercase tracking-wider group-hover:gap-2 transition-all">
            View pool <ArrowUpRight className="size-4" />
          </span>
        </footer>
      </article>
    </Link>
  );
}
