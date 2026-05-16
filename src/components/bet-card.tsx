"use client";

/**
 * BetCard — single bet preview card.
 * - Defensive nulls on stakeUnits (bigToStr returns string | null)
 * - BigInt parse for stake formatting (no float precision loss)
 * - Status badge variants mapped to all 10 BetStatus enum values
 */

import Link from "next/link";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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

function formatExpiry(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const diffMs = t - Date.now();
  if (diffMs < 0) return "expired";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "< 1h left";
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
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
      // Exhaustiveness check: TS errors if BetStatus enum grows
      const _exhaustive: never = status;
      return "outline";
    }
  }
}

export function BetCard({ bet }: { bet: BetSerialized }) {
  return (
    <Link href={`/bets/${bet.id}`} className="block transition-opacity hover:opacity-90">
      <Card className="h-full">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-medium">
            {bet.creatorSide} <span className="text-muted-foreground">vs</span> {bet.acceptorSide}
          </CardTitle>
          <div className="flex items-center gap-1">
            {bet.category && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {bet.category}
              </Badge>
            )}
            <Badge variant={statusVariant(bet.status as BetStatus)}>{bet.status}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${formatStake(bet.stakeUnits)}</div>
          <div className="text-xs text-muted-foreground">USDC stake</div>
        </CardContent>
        <CardFooter className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatExpiry(bet.expiresAt)}
          </span>
          {bet.isCustom && (
            <Badge variant="secondary" className="text-[9px]">
              Custom
            </Badge>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}
