import { Badge } from "@/components/ui/badge";
import type { BetStatus } from "@/lib/api/bets";

const LABELS: Record<BetStatus, string> = {
  DRAFT: "Concept",
  PENDING_ESCROW: "Stakes vergrendelen...",
  OPEN: "Open",
  ACTIVE: "Actief",
  RESULT_PROPOSED: "Resultaat ingediend",
  AWAITING_CONFIRMATION: "Wacht op bevestiging",
  DISPUTED: "Betwist",
  SETTLED: "Afgehandeld",
  CANCELLED: "Geannuleerd",
  EXPIRED: "Verlopen",
  VOID: "Voided",
};

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const VARIANTS: Record<BetStatus, BadgeVariant> = {
  DRAFT: "outline",
  PENDING_ESCROW: "secondary",
  OPEN: "default",
  ACTIVE: "default",
  RESULT_PROPOSED: "secondary",
  AWAITING_CONFIRMATION: "secondary",
  DISPUTED: "destructive",
  SETTLED: "default",
  CANCELLED: "outline",
  EXPIRED: "outline",
  VOID: "outline",
};

export function BetStatusBadge({
  status,
  className,
}: {
  status: BetStatus;
  className?: string;
}) {
  return (
    <Badge variant={VARIANTS[status]} className={className}>
      {LABELS[status]}
    </Badge>
  );
}
