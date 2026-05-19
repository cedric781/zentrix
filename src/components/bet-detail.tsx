"use client";

/**
 * BetDetail — single bet view with state-aware action buttons.
 * B.5: wires acceptBet mutation with caller identity check via useCurrentUser.
 *
 * Caller permission rules (client-side UX; server enforces canonical):
 *   - Accept button: enabled iff status===OPEN && user.id !== bet.createdById
 *   - Other actions: still stubs until B.6+
 *
 * Mutation flow:
 *   1. useMutation(acceptBet) — disables button during fetch
 *   2. On success: invalidate ["bet", id] + ["bets"] → fresh data
 *   3. Toast feedback via sonner
 */

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCurrentUser } from "@/hooks/use-current-user";
import { acceptBet } from "@/lib/api/bets";
import { ApiError } from "@/lib/api/client";
import type { BetSerialized } from "@/lib/api/types";
import type { BetStatus } from "@/lib/api/bets";

const USDC_DECIMALS = 1_000_000n;

function formatStake(stakeUnits: string | null): string {
  if (!stakeUnits) return "\u2014";
  let amount: bigint;
  try {
    amount = BigInt(stakeUnits);
  } catch {
    return "\u2014";
  }
  const whole = amount / USDC_DECIMALS;
  const fraction = amount % USDC_DECIMALS;
  const fractionStr = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return fractionStr.length > 0 ? `${whole}.${fractionStr}` : whole.toString();
}

function formatDate(iso: string | null): string {
  if (!iso) return "\u2014";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "\u2014";
  return new Date(t).toLocaleString();
}

type StatusVariant = "default" | "secondary" | "destructive" | "outline";

function statusVariant(status: BetStatus): StatusVariant {
  switch (status) {
    case "OPEN":
    case "DRAFT":
      return "default";
    case "ACTIVE":
    case "RESULT_PROPOSED":
    case "AWAITING_CONFIRMATION":
      return "secondary";
    case "SETTLED":
      return "outline";
    case "DISPUTED":
    case "EXPIRED":
    case "VOID":
    case "CANCELLED":
      return "destructive";
    default: {
      const _exhaustive: never = status;
      return "outline";
    }
  }
}

export function BetDetail({ bet }: { bet: BetSerialized }) {
  const status = bet.status as BetStatus;
  const { data: me } = useCurrentUser();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/feed" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to feed
          </Link>
          <h1 className="mt-2 text-3xl font-bold">
            {bet.creatorSide} <span className="text-muted-foreground">vs</span> {bet.acceptorSide}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">ID: {bet.id}</p>
        </div>
        <Badge variant={statusVariant(status)} className="text-sm">
          {bet.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stake</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold">${formatStake(bet.stakeUnits)}</div>
          <div className="mt-1 text-sm text-muted-foreground">USDC per side</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Participants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Creator" value={bet.createdById} mono />
          <Row label="Opponent" value={bet.opponentUserId ?? "(open)"} mono={Boolean(bet.opponentUserId)} />
          <Row label="Settlement mode" value={bet.settlementMode} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Created" value={formatDate(bet.createdAt)} />
          <Row label="Expires" value={formatDate(bet.expiresAt)} />
          {bet.confirmDeadline && <Row label="Confirm by" value={formatDate(bet.confirmDeadline)} />}
          {bet.disputeWindowEndsAt && (
            <Row label="Dispute window ends" value={formatDate(bet.disputeWindowEndsAt)} />
          )}
          {bet.settledAt && <Row label="Settled" value={formatDate(bet.settledAt)} />}
          {bet.cancelledAt && <Row label="Cancelled" value={formatDate(bet.cancelledAt)} />}
          {bet.voidedAt && <Row label="Voided" value={formatDate(bet.voidedAt)} />}
        </CardContent>
      </Card>

      {bet.resultStatus && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Status" value={bet.resultStatus} />
            {bet.winnerId && <Row label="Winner" value={bet.winnerId} mono />}
          </CardContent>
        </Card>
      )}

      <Separator />

      <ActionPanel bet={bet} status={status} myUserId={me?.id ?? null} />
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "text-right"}>
        {value}
      </span>
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
        toast.error(`Couldn\u2019t accept bet: ${err.message}`, { description: `Code: ${err.code}` });
      } else {
        toast.error(err instanceof Error ? err.message : "Unknown error");
      }
    },
  });

  if (status === "OPEN") {
    const isOwnBet = myUserId !== null && myUserId === bet.createdById;
    const canAccept = myUserId !== null && !isOwnBet;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => acceptMutation.mutate()}
            disabled={!canAccept || acceptMutation.isPending}
          >
            {acceptMutation.isPending ? "Accepting\u2026" : "Accept bet"}
          </Button>
          <Button variant="outline" disabled title="Cancel action comes in a later phase">
            Cancel
          </Button>
        </div>
        {isOwnBet && (
          <p className="text-xs text-muted-foreground">
            You created this bet \u2014 wait for someone to accept.
          </p>
        )}
        {!myUserId && (
          <p className="text-xs text-muted-foreground">Sign in to accept this bet.</p>
        )}
      </div>
    );
  }

  if (status === "ACTIVE") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button disabled title="Submit result handler comes in a later phase">
          Submit result
        </Button>
      </div>
    );
  }

  if (status === "RESULT_PROPOSED" || status === "AWAITING_CONFIRMATION") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button disabled title="Confirm handler comes in a later phase">Confirm result</Button>
        <Button variant="destructive" disabled title="Dispute handler comes in a later phase">
          Dispute
        </Button>
      </div>
    );
  }

  if (status === "DISPUTED") {
    return (
      <p className="text-sm text-muted-foreground">
        Dispute in progress. An arbiter will resolve this within the dispute window.
      </p>
    );
  }

  if (status === "SETTLED") {
    return <p className="text-sm text-muted-foreground">This bet is settled.</p>;
  }

  if (status === "EXPIRED") {
    return <p className="text-sm text-muted-foreground">This bet expired without acceptance. Stake was refunded.</p>;
  }

  if (status === "VOID") {
    return <p className="text-sm text-muted-foreground">This bet was voided. Both stakes were refunded.</p>;
  }

  if (status === "CANCELLED") {
    return <p className="text-sm text-muted-foreground">This bet was cancelled before acceptance.</p>;
  }

  return <p className="text-sm text-muted-foreground">Draft \u2014 not yet open.</p>;
}
