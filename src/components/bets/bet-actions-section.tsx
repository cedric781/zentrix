"use client";

import { useBetDetail } from "@/hooks/use-bet-detail";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BetStatusBadge } from "./bet-status-badge";
import { ConfirmOutcomePanel } from "./confirm-outcome-panel";
import { OpenDisputeForm } from "./open-dispute-form";
import { ProposeResultCard } from "./propose-result-card";
import type { BetSerialized } from "@/lib/api/types";

interface Props {
  betId: string;
}

export function BetActionsSection({ betId }: Props) {
  const { data: bet, isLoading, error } = useBetDetail(betId);
  const { data: me } = useCurrentUser();
  const userId = me?.id ?? null;

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (error || !bet) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Kon bet niet laden.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!userId) {
    return <StatusOnlyCard bet={bet} />;
  }

  const role = getRole(userId, bet);

  if (role === "spectator") {
    return <StatusOnlyCard bet={bet} />;
  }

  if (bet.status === "ACTIVE") {
    return <ProposeResultCard bet={bet} />;
  }

  if (
    bet.status === "RESULT_PROPOSED" ||
    bet.status === "AWAITING_CONFIRMATION"
  ) {
    const claim = bet.latestClaim;
    if (!claim) {
      // Edge: status RESULT_PROPOSED maar geen claim row — backend race
      // window of inconsistency. Fallback toont neutral message, geen crash.
      return (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Wacht op claim data…
            </p>
          </CardContent>
        </Card>
      );
    }

    if (claim.claimedById === userId) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Wacht op bevestiging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Je tegenpartij moet bevestigen of betwisten.
            </p>
            <BetStatusBadge status={bet.status} />
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        <ConfirmOutcomePanel bet={bet} claim={claim} />
        <OpenDisputeForm bet={bet} claim={claim} />
      </div>
    );
  }

  if (bet.status === "DISPUTED") {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <BetStatusBadge status={bet.status} />
          <p className="text-sm text-muted-foreground">
            Deze bet is betwist. Settlement is gepauzeerd. Dispuut-functionaliteit
            komt in P27.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (
    bet.status === "SETTLED" ||
    bet.status === "VOID" ||
    bet.status === "EXPIRED" ||
    bet.status === "CANCELLED"
  ) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <BetStatusBadge status={bet.status} />
          </div>
          {bet.status === "SETTLED" && bet.winnerId && (
            <p className="text-sm">
              Winnaar:{" "}
              <span className="font-semibold">
                {winnerOutcome(bet)}
              </span>
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return <StatusOnlyCard bet={bet} />;
}

function StatusOnlyCard({ bet }: { bet: BetSerialized }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-6">
        <span className="text-sm text-muted-foreground">Status</span>
        <BetStatusBadge status={bet.status} />
      </CardContent>
    </Card>
  );
}

function getRole(
  userId: string,
  bet: BetSerialized,
): "creator" | "opponent" | "spectator" {
  if (bet.createdById === userId) return "creator";
  if (bet.opponentUserId === userId) return "opponent";
  return "spectator";
}

/**
 * SETTLED only — derive winning outcome via winnerId → side mapping.
 * winnerId matches creator → creatorSide is winning side; else acceptorSide.
 * Then map A/B to outcomeA/outcomeB.
 */
function winnerOutcome(bet: BetSerialized): string {
  const winningSide =
    bet.winnerId === bet.createdById ? bet.creatorSide : bet.acceptorSide;
  return winningSide === "A" ? bet.outcomeA : bet.outcomeB;
}
