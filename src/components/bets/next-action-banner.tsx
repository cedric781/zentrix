"use client";

import { AlertCircle, CheckCircle2, Clock, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BetSerialized } from "@/lib/api/types";

type IconComponent = typeof Clock;

type ActionContext = {
  message: string;
  detail?: string;
  icon: IconComponent;
  tone: "info" | "action" | "warning" | "success";
};

function getNextAction(
  bet: BetSerialized,
  currentUserId: string | null,
): ActionContext | null {
  if (!currentUserId) {
    return {
      message: "Sign in to interact with this bet",
      icon: AlertCircle,
      tone: "info",
    };
  }

  const isCreator = bet.createdById === currentUserId;
  const isOpponent = bet.opponentUserId === currentUserId;
  const isParticipant = isCreator || isOpponent;

  if (!isParticipant && bet.status === "OPEN") {
    return {
      message: "Accept this bet to participate",
      detail: "You will stake the same amount as the creator.",
      icon: Clock,
      tone: "action",
    };
  }

  switch (bet.status) {
    case "OPEN":
      return isCreator
        ? {
            message: "Waiting for opponent to accept",
            detail: bet.expiresAt
              ? "Bet will expire if not accepted."
              : undefined,
            icon: Hourglass,
            tone: "info",
          }
        : null;

    case "ACTIVE":
      return {
        message: "Bet is active",
        detail: "Submit a result once the outcome is known.",
        icon: Clock,
        tone: "info",
      };

    case "RESULT_PROPOSED":
      return {
        message: "Result has been proposed",
        detail: "Confirm or dispute the proposed outcome.",
        icon: AlertCircle,
        tone: "warning",
      };

    case "AWAITING_CONFIRMATION":
      return {
        message: "Awaiting confirmation",
        detail: "Other party needs to respond.",
        icon: Hourglass,
        tone: "warning",
      };

    case "DISPUTED":
      return {
        message: "Bet is under dispute",
        detail: "An admin is reviewing the evidence.",
        icon: AlertCircle,
        tone: "warning",
      };

    case "SETTLED":
      return {
        message: "Bet settled",
        detail:
          bet.winnerId === currentUserId ? "You won!" : "Payout completed.",
        icon: CheckCircle2,
        tone: "success",
      };

    case "CANCELLED":
    case "EXPIRED":
    case "VOID":
      return {
        message: `Bet ${bet.status.toLowerCase()}`,
        detail: "Stakes refunded if applicable.",
        icon: AlertCircle,
        tone: "info",
      };

    default:
      return null;
  }
}

type Props = {
  bet: BetSerialized;
  currentUserId: string | null;
  className?: string;
};

export function NextActionBanner({ bet, currentUserId, className }: Props) {
  const action = getNextAction(bet, currentUserId);

  if (!action) return null;

  const Icon = action.icon;

  return (
    <div
      className={cn(
        "flex gap-3 items-start rounded-xl border p-4",
        action.tone === "action" &&
          "border-[var(--brand)]/30 bg-[var(--brand)]/5",
        action.tone === "warning" && "border-amber-500/30 bg-amber-500/5",
        action.tone === "success" && "border-emerald-500/30 bg-emerald-500/5",
        action.tone === "info" && "border-muted-foreground/20 bg-muted/30",
        className,
      )}
    >
      <Icon
        className={cn(
          "size-5 shrink-0 mt-0.5",
          action.tone === "action" && "text-[var(--brand)]",
          action.tone === "warning" && "text-amber-500",
          action.tone === "success" && "text-emerald-500",
          action.tone === "info" && "text-muted-foreground",
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{action.message}</p>
        {action.detail && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {action.detail}
          </p>
        )}
      </div>
    </div>
  );
}
