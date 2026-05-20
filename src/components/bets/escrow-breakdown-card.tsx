import { GlassPanel } from "@/components/landing/glass-panel";
import { formatUsdc } from "@/lib/money/units";
import type { BetSerialized } from "@/lib/api/types";

type Props = {
  bet: BetSerialized;
};

const PLATFORM_FEE_BPS = 200n; // 2.00% — Zentrix platform fee
const BPS_DENOMINATOR = 10_000n;

export function EscrowBreakdownCard({ bet }: Props) {
  if (!bet.stakeUnits) return null;
  const stake = BigInt(bet.stakeUnits);
  const pot = stake * 2n;
  const platformFee = (pot * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const winnerPayout = pot - platformFee;

  return (
    <GlassPanel className="p-4 space-y-3">
      <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Escrow
      </h3>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Per side</span>
          <span className="font-mono tabular-nums">
            {formatUsdc(stake)} USDC
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-muted-foreground">Total pot</span>
          <span className="font-mono tabular-nums">{formatUsdc(pot)} USDC</span>
        </div>

        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Platform fee (2%)</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            −{formatUsdc(platformFee)}
          </span>
        </div>

        <div className="pt-2 mt-2 border-t border-border/50 flex justify-between">
          <span className="font-semibold">Winner receives</span>
          <span className="font-mono tabular-nums font-semibold text-[var(--brand)]">
            {formatUsdc(winnerPayout)} USDC
          </span>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/70 leading-relaxed pt-2">
        Funds are escrowed on-chain via Solana USDC. Platform fee applies only
        on settled bets.
      </p>
    </GlassPanel>
  );
}
