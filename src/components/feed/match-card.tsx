"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CountdownTimer } from "@/components/bets/countdown-timer";
import { BET_STATUS_CONFIG } from "@/lib/bets/status-config";
import { formatUsdc } from "@/lib/money/units";
import { getCategoryByDbValue } from "@/lib/categories/config";
import { cn } from "@/lib/utils";

type MatchCardProps = {
  bet: {
    id: string;
    title: string | null;
    creatorSide: string;
    acceptorSide: string | null;
    status: string;
    stakeUnits: string | number | bigint;
    category: string | null;
    expiresAt: string | Date | null;
    createdAt: string | Date;
  };
};

export function MatchCard({ bet }: MatchCardProps) {
  const statusConfig = BET_STATUS_CONFIG[bet.status as keyof typeof BET_STATUS_CONFIG];
  const category = bet.category ? getCategoryByDbValue(bet.category) : null;
  const isLive = bet.status === "ACTIVE";

  return (
    <Link href={`/bets/${bet.id}`} className="block group">
      <article className="glass-panel rounded-2xl p-5 border border-[var(--outline-variant)]/40 hover:border-[var(--brand)]/40 transition-all">
        <header className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {isLive && (
              <span
                className="flex h-2 w-2 rounded-full bg-[var(--brand)] animate-pulse"
                aria-hidden="true"
              />
            )}
            {statusConfig && (
              <span
                className={cn(
                  "font-mono text-[10px] uppercase tracking-widest",
                  isLive ? "text-[var(--brand)]" : "text-muted-foreground",
                )}
              >
                {statusConfig.label}
              </span>
            )}
            {category && (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {category.label}
                </span>
              </>
            )}
          </div>

          {bet.expiresAt && isLive && (
            <CountdownTimer
              targetDate={bet.expiresAt}
              className="text-xs font-mono text-muted-foreground"
            />
          )}
        </header>

        {bet.title && (
          <h3 className="font-display text-lg font-bold tracking-tight text-foreground mb-3 line-clamp-1">
            {bet.title}
          </h3>
        )}

        <div className="bg-[var(--surface-container-low)]/60 rounded-xl p-4 mb-4 flex items-center justify-center gap-6">
          <div className="text-center flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Side A
            </p>
            <span className="font-display text-xl font-bold text-foreground line-clamp-1">
              {bet.creatorSide}
            </span>
          </div>

          <div className="font-mono text-xs text-muted-foreground/50">VS</div>

          <div className="text-center flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Side B
            </p>
            <span className="font-display text-xl font-bold text-foreground line-clamp-1">
              {bet.acceptorSide ?? "Open"}
            </span>
          </div>
        </div>

        <footer className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
              Stake per side
            </p>
            <p className="font-mono text-sm font-bold text-foreground">
              {formatUsdc(BigInt(String(bet.stakeUnits)))}
            </p>
          </div>

          <span className="inline-flex items-center gap-1 text-[var(--brand)] font-mono text-xs uppercase tracking-wider group-hover:gap-2 transition-all">
            View bet <ArrowUpRight className="size-4" />
          </span>
        </footer>
      </article>
    </Link>
  );
}
