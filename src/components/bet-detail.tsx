"use client";

/**
 * BetDetail — single bet view with state-aware action buttons.
 *
 * B.4 scope: read-only display + action button STUBS (no mutations).
 * Actions wire to handlers in B.5 (mutate-side: accept, propose result, etc).
 *
 * Per-status action matrix (caller identity from Privy):
 *   OPEN + not creator                → "Accept bet"
 *   ACTIVE + participant              → "Submit result"
 *   RESULT_PROPOSED + opponent        → "Confirm" / "Dispute"
 *   AWAITING_CONFIRMATION + opponent  → "Confirm result"
 *   SETTLED                           → show winner
 *   DISPUTED/EXPIRED/VOID/CANCELLED   → read-only with status reason
 *
 * Caller identity check uses Privy user.id mapped to backend userId.
 * NOTE: server enforces all state transitions — client buttons are UX only.
 */

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
  const { user } = usePrivy();
  // Privy user.id is NOT the same as backend userId. Resolving the mapping
  // requires a /api/me call (server resolves Privy DID -> internal User.id).
  // For B.4 we use a heuristic: render all action buttons but disable them with
  // a "wire-up in B.5" tooltip. B.5 introduces /api/me + permission resolver.
  const callerKnown = Boolean(user);

  const status = bet.status as BetStatus;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/feed" className="text-sm text-muted-foreground hover:underline">
            \u2190 Back to feed
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

      <ActionPanel status={status} callerKnown={callerKnown} />
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

function ActionPanel({ status, callerKnown }: { status: BetStatus; callerKnown: boolean }) {
  // All buttons disabled in B.4. B.5 wires real mutations + permission checks.
  const disabledTitle = "Action handler comes in B.5";

  if (status === "OPEN") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button disabled={!callerKnown} title={disabledTitle}>Accept bet</Button>
        <Button variant="outline" disabled title={disabledTitle}>Cancel</Button>
      </div>
    );
  }

  if (status === "ACTIVE") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button disabled title={disabledTitle}>Submit result</Button>
      </div>
    );
  }

  if (status === "RESULT_PROPOSED" || status === "AWAITING_CONFIRMATION") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button disabled title={disabledTitle}>Confirm result</Button>
        <Button variant="destructive" disabled title={disabledTitle}>Dispute</Button>
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

  // DRAFT — not user-visible normally
  return <p className="text-sm text-muted-foreground">Draft \u2014 not yet open.</p>;
}
