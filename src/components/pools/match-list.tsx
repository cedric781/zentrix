"use client";

import type { MatchSerialized } from "@/lib/api/types";

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  RESULT_SUBMITTED: "Result submitted",
  SETTLED: "Settled",
  DISPUTED: "Disputed",
};

function formatEventTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MatchList({ matches }: { matches: MatchSerialized[] }) {
  if (matches.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">No matches yet</p>
        <p className="text-xs text-muted-foreground">
          The creator hasn&apos;t added any matches to this pool.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {matches.map((match) => {
        const eventTime = formatEventTime(match.eventTime);
        return (
          <li
            key={match.id}
            className="glass-panel rounded-xl p-4 border border-[var(--outline-variant)]/40 flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground line-clamp-1">
                {match.title}
              </h3>
              {match.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {match.description}
                </p>
              )}
              {eventTime && (
                <p className="text-xs font-mono text-muted-foreground mt-2">
                  {eventTime}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {STATUS_LABELS[match.status] ?? match.status}
              </span>
              {match.winnerSide && (
                <p className="font-semibold text-sm mt-1">
                  Winner: {match.winnerSide}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
