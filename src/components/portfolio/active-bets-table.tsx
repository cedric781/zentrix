"use client";

import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import { useBets } from "@/hooks/use-bets";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getStatusConfig } from "@/lib/bets/status-config";
import { formatUsdc } from "@/lib/money/units";
import { getCategoryByDbValue } from "@/lib/categories/config";
import { cn } from "@/lib/utils";
import type { BetSerialized } from "@/lib/api/types";
import type { BetStatus } from "@/lib/api/bets";

const TERMINAL_STATES: BetStatus[] = ["SETTLED", "CANCELLED", "EXPIRED", "VOID"];

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-[var(--surface-container-high)]/60 text-muted-foreground border-[var(--outline-variant)]/40",
  active: "bg-[var(--brand)]/10 text-[var(--brand)] border-[var(--brand)]/30",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  danger: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

function formatStake(stakeUnits: string | null): string {
  if (!stakeUnits) return "—";
  try {
    return formatUsdc(BigInt(stakeUnits));
  } catch {
    return "—";
  }
}

export function ActiveBetsTable() {
  const { data: user } = useCurrentUser();
  const { data, isLoading, error } = useBets({ scope: "mine" });

  if (isLoading) {
    return (
      <div className="glass-panel rounded-xl p-12 border border-[var(--outline-variant)]/40 text-center text-muted-foreground">
        Loading positions...
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-xl p-12 border border-[var(--outline-variant)]/40 text-center text-muted-foreground">
        Could not load positions.
      </div>
    );
  }

  const allBets: BetSerialized[] =
    data?.pages?.flatMap((p) => p.items) ?? [];

  const activeBets = allBets.filter(
    (bet) => !TERMINAL_STATES.includes(bet.status as BetStatus),
  );

  if (activeBets.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-12 border border-[var(--outline-variant)]/40 text-center">
        <Inbox className="size-10 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-muted-foreground mb-4">No open positions yet.</p>
        <Link
          href="/templates"
          className="inline-flex items-center gap-2 text-sm font-mono uppercase tracking-wider text-[var(--brand)] hover:underline"
        >
          Browse templates <ArrowUpRight className="size-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl border border-[var(--outline-variant)]/40 overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--outline-variant)]/30 bg-[var(--surface-container-low)]/50 flex justify-between items-center">
        <h4 className="font-mono text-[11px] uppercase tracking-widest text-foreground">
          Open Positions ({activeBets.length})
        </h4>
        <Link
          href="/feed"
          className="text-[var(--brand)] text-xs font-bold flex items-center gap-1 hover:underline font-mono uppercase tracking-wider"
        >
          View all feed <ArrowUpRight className="size-3" />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-[var(--surface-container-high)]/40 border-b border-[var(--outline-variant)]/20">
              <th className="px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Bet</th>
              <th className="px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Category</th>
              <th className="px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Stake</th>
              <th className="px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Status</th>
              <th className="px-6 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--outline-variant)]/10">
            {activeBets.map((bet) => {
              const statusConfig = getStatusConfig(bet.status as BetStatus);
              const category = bet.category ? getCategoryByDbValue(bet.category) : null;
              const isCreator = bet.createdById === user?.id;
              const toneClass = TONE_CLASSES[statusConfig.tone] ?? TONE_CLASSES.neutral;

              return (
                <tr key={bet.id} className="hover:bg-[var(--brand)]/5 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-foreground">
                      {bet.title || `${bet.creatorSide ?? "Creator"} vs ${bet.acceptorSide ?? "Opponent"}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      #{bet.id.slice(0, 8)} · {isCreator ? "Creator" : "Opponent"}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    {category ? (
                      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        {category.label}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono">
                    {formatStake(bet.stakeUnits)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold border font-mono uppercase tracking-wider",
                        toneClass,
                      )}
                    >
                      {statusConfig.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/bets/${bet.id}`}
                      className="inline-block px-3 py-1.5 rounded bg-[var(--brand)] text-[var(--background)] text-[10px] font-bold hover:brightness-110 transition-all font-mono uppercase tracking-wider"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
