import { Badge } from "@/components/ui/badge";
import type { PoolStatus } from "@/lib/api/pools";

const LABELS: Record<PoolStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  CLOSED: "Closed",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
};

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const VARIANTS: Record<PoolStatus, BadgeVariant> = {
  DRAFT: "outline",
  OPEN: "default",
  CLOSED: "secondary",
  SETTLED: "default",
  CANCELLED: "outline",
};

export function PoolStatusBadge({
  status,
  className,
}: {
  status: PoolStatus;
  className?: string;
}) {
  return (
    <Badge variant={VARIANTS[status]} className={className}>
      {LABELS[status]}
    </Badge>
  );
}
