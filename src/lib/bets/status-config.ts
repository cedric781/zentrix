import type { BetStatus } from "@prisma/client";

type StatusConfig = {
  label: string;
  description: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  tone: "neutral" | "active" | "success" | "warning" | "danger";
};

export const BET_STATUS_CONFIG: Record<BetStatus, StatusConfig> = {
  DRAFT: {
    label: "Draft",
    description: "Bet created but not yet open for opponents.",
    variant: "outline",
    tone: "neutral",
  },
  PENDING_ESCROW: {
    label: "Locking Stakes",
    description: "On-chain stake deposit in progress. Please wait.",
    variant: "secondary",
    tone: "warning",
  },
  OPEN: {
    label: "Open",
    description: "Waiting for an opponent to accept this bet.",
    variant: "default",
    tone: "active",
  },
  ACTIVE: {
    label: "Active",
    description: "Bet accepted. Awaiting outcome.",
    variant: "default",
    tone: "active",
  },
  RESULT_PROPOSED: {
    label: "Result Proposed",
    description: "A result has been proposed. Awaiting confirmation.",
    variant: "secondary",
    tone: "warning",
  },
  AWAITING_CONFIRMATION: {
    label: "Awaiting Confirmation",
    description: "Other party needs to confirm the outcome.",
    variant: "secondary",
    tone: "warning",
  },
  DISPUTED: {
    label: "Disputed",
    description: "This bet is under dispute review.",
    variant: "destructive",
    tone: "danger",
  },
  SETTLED: {
    label: "Settled",
    description: "Bet resolved and payout distributed.",
    variant: "default",
    tone: "success",
  },
  CANCELLED: {
    label: "Cancelled",
    description: "Bet was cancelled before acceptance.",
    variant: "outline",
    tone: "neutral",
  },
  EXPIRED: {
    label: "Expired",
    description: "Bet expired without acceptance.",
    variant: "outline",
    tone: "neutral",
  },
  VOID: {
    label: "Void",
    description: "Bet was voided and stakes refunded.",
    variant: "outline",
    tone: "neutral",
  },
};

export function getStatusConfig(status: BetStatus): StatusConfig {
  return BET_STATUS_CONFIG[status];
}
