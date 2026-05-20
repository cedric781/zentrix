import { CheckCircle2, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/landing/glass-panel";
import type { BetSerialized } from "@/lib/api/types";

type TimelineEvent = {
  id: string;
  label: string;
  timestamp?: string | null;
  status: "complete" | "current" | "pending";
};

function buildTimeline(bet: BetSerialized): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: "created",
      label: "Created",
      timestamp: bet.createdAt,
      status: "complete",
    },
  ];

  // Opened (transitioned from DRAFT). Bet model lacks an explicit openedAt;
  // createdAt is the best proxy when status is past DRAFT.
  if (bet.status !== "DRAFT") {
    events.push({
      id: "opened",
      label: "Opened for matching",
      timestamp: bet.createdAt,
      status: "complete",
    });
  }

  // Accepted — Bet model has no acceptedAt timestamp in BetSerialized output,
  // so we mark this event without a timestamp when bet is past OPEN.
  if (
    bet.status === "ACTIVE" ||
    bet.status === "RESULT_PROPOSED" ||
    bet.status === "AWAITING_CONFIRMATION" ||
    bet.status === "DISPUTED" ||
    bet.status === "SETTLED"
  ) {
    events.push({
      id: "accepted",
      label: "Accepted",
      timestamp: null,
      status: "complete",
    });
  } else if (bet.status === "OPEN") {
    events.push({
      id: "accepted",
      label: "Awaiting acceptance",
      timestamp: bet.expiresAt,
      status: "current",
    });
  }

  // Result proposed — use latestClaim timestamp when available
  if (
    bet.status === "RESULT_PROPOSED" ||
    bet.status === "AWAITING_CONFIRMATION"
  ) {
    events.push({
      id: "proposed",
      label: "Result proposed",
      timestamp: bet.latestClaim?.createdAt ?? null,
      status: "current",
    });
  }

  // Final state
  if (bet.settledAt) {
    events.push({
      id: "settled",
      label: "Settled",
      timestamp: bet.settledAt,
      status: "complete",
    });
  } else if (bet.cancelledAt) {
    events.push({
      id: "cancelled",
      label: "Cancelled",
      timestamp: bet.cancelledAt,
      status: "complete",
    });
  } else if (bet.voidedAt) {
    events.push({
      id: "voided",
      label: "Voided",
      timestamp: bet.voidedAt,
      status: "complete",
    });
  }

  return events;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  bet: BetSerialized;
  className?: string;
};

export function BetTimeline({ bet, className }: Props) {
  const events = buildTimeline(bet);

  return (
    <GlassPanel className={cn("p-4", className)}>
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mb-4">
        Timeline
      </h3>
      <ol className="space-y-3">
        {events.map((event) => {
          const Icon =
            event.status === "complete"
              ? CheckCircle2
              : event.status === "current"
                ? Clock
                : Circle;

          return (
            <li key={event.id} className="flex gap-3 items-start">
              <Icon
                className={cn(
                  "size-4 mt-0.5 shrink-0",
                  event.status === "complete" && "text-[var(--brand)]",
                  event.status === "current" && "text-amber-500",
                  event.status === "pending" && "text-muted-foreground/40",
                )}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    event.status === "pending" && "text-muted-foreground",
                  )}
                >
                  {event.label}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {formatTimestamp(event.timestamp)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </GlassPanel>
  );
}
