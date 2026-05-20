"use client";

/**
 * BetDetail — 2-col bet view (P51 restyle).
 *
 * P26 LIVE flow preserved:
 *   - OPEN state: local ActionPanel hosts the accept-bet mutation
 *   - ACTIVE+ states: BetActionsSection (P26 propose/confirm/dispute) untouched
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCurrentUser } from "@/hooks/use-current-user";
import { acceptBet } from "@/lib/api/bets";
import { ApiError } from "@/lib/api/client";
import { formatUsdc } from "@/lib/money/units";
import { getStatusConfig } from "@/lib/bets/status-config";
import { CountdownTimer } from "@/components/bets/countdown-timer";
import { BetTimeline } from "@/components/bets/bet-timeline";
import { NextActionBanner } from "@/components/bets/next-action-banner";
import { EscrowBreakdownCard } from "@/components/bets/escrow-breakdown-card";
import { BetActionsSection } from "@/components/bets/bet-actions-section";
import { BetStatusBadge } from "@/components/bets/bet-status-badge";
import type { BetSerialized } from "@/lib/api/types";
import type { BetStatus } from "@/lib/api/bets";

function formatStake(stakeUnits: string | null): string {
  if (!stakeUnits) return "—";
  try {
    return formatUsdc(BigInt(stakeUnits));
  } catch {
    return "—";
  }
}

type Props = {
  bet: BetSerialized;
};

export function BetDetail({ bet }: Props) {
  const status = bet.status as BetStatus;
  const { data: me } = useCurrentUser();
  const currentUserId = me?.id ?? null;

  const config = getStatusConfig(status);
  const displayTitle =
    bet.title || `${bet.creatorSide} vs ${bet.acceptorSide}`;

  const countdownTarget =
    status === "OPEN"
      ? bet.expiresAt
      : status === "RESULT_PROPOSED" || status === "AWAITING_CONFIRMATION"
        ? bet.confirmDeadline
        : status === "DISPUTED"
          ? bet.disputeWindowEndsAt
          : null;

  const countdownLabel =
    status === "OPEN"
      ? "Expires"
      : status === "RESULT_PROPOSED" || status === "AWAITING_CONFIRMATION"
        ? "Confirm by"
        : status === "DISPUTED"
          ? "Dispute ends"
          : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Link
        href="/feed"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to feed
      </Link>

      <header className="mb-8 grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <BetStatusBadge status={status} />
            <span className="text-xs font-mono text-muted-foreground">
              #{bet.id.slice(0, 8)}
            </span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {displayTitle}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {config.description}
          </p>
        </div>

        {countdownTarget && (
          <CountdownTimer
            targetDate={countdownTarget}
            label={countdownLabel}
            className="md:items-end"
          />
        )}
      </header>

      <NextActionBanner
        bet={bet}
        currentUserId={currentUserId}
        className="mb-6"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {status === "OPEN" ? (
            <ActionPanel bet={bet} status={status} myUserId={currentUserId} />
          ) : (
            <BetActionsSection betId={bet.id} />
          )}

          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Participants
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Creator</p>
                  <p className="font-medium">{bet.creatorSide}</p>
                  <p className="text-xs font-mono text-muted-foreground mt-1 break-all">
                    {bet.createdById.slice(0, 12)}…
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">Opponent</p>
                  <p className="font-medium">
                    {bet.opponentUserId
                      ? (bet.acceptorSide ?? "")
                      : "Open for any opponent"}
                  </p>
                  {bet.opponentUserId && (
                    <p className="text-xs font-mono text-muted-foreground mt-1 break-all">
                      {bet.opponentUserId.slice(0, 12)}…
                    </p>
                  )}
                </div>
              </div>

              <Separator />

              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Stake per side</p>
                  <p className="font-mono tabular-nums">
                    {formatStake(bet.stakeUnits)} USDC
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Settlement mode
                  </p>
                  <p className="font-mono text-xs">{bet.settlementMode}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {bet.resultStatus && bet.resultStatus !== "PENDING" && (
            <Card>
              <CardContent className="p-6 space-y-3">
                <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Result
                </h2>
                <div className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-right">{bet.resultStatus}</span>
                </div>
                {bet.winnerId && (
                  <div className="flex items-start justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Winner</span>
                    <span className="font-mono text-xs break-all text-right">
                      {bet.winnerId}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <EscrowBreakdownCard bet={bet} />
          <BetTimeline bet={bet} />
        </aside>
      </div>
    </div>
  );
}

function ActionPanel({
  bet,
  status,
  myUserId,
}: {
  bet: BetSerialized;
  status: BetStatus;
  myUserId: string | null;
}) {
  const queryClient = useQueryClient();

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!myUserId) throw new Error("Not signed in");
      return acceptBet(
        { betId: bet.id },
        { idempotencyKey: crypto.randomUUID() },
      );
    },
    onSuccess: () => {
      toast.success("Bet accepted");
      queryClient.invalidateQueries({ queryKey: ["bet", bet.id] });
      queryClient.invalidateQueries({ queryKey: ["bets"] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(`Couldn’t accept bet: ${err.message}`, {
          description: `Code: ${err.code}`,
        });
      } else {
        toast.error(err instanceof Error ? err.message : "Unknown error");
      }
    },
  });

  if (status !== "OPEN") return null;

  const isOwnBet = myUserId !== null && myUserId === bet.createdById;
  const canAccept = myUserId !== null && !isOwnBet;

  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => acceptMutation.mutate()}
            disabled={!canAccept || acceptMutation.isPending}
          >
            {acceptMutation.isPending ? "Accepting…" : "Accept bet"}
          </Button>
          <Button
            variant="outline"
            disabled
            title="Cancel action comes in a later phase"
          >
            Cancel
          </Button>
        </div>
        {isOwnBet && (
          <p className="text-xs text-muted-foreground">
            You created this bet — wait for someone to accept.
          </p>
        )}
        {!myUserId && (
          <p className="text-xs text-muted-foreground">
            Sign in to accept this bet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
