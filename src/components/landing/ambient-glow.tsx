import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

/**
 * Decorative ambient background glow (2 radial spots).
 * Pure CSS — no JS, no mouse tracking, no animations.
 * Mouse tracking causes mobile jank + battery drain; static glow gives
 * 80% of the visual effect with 0% of the cost.
 */
export function AmbientGlow({ className }: Props) {
  return (
    <div
      className={cn("ambient-glow-container", className)}
      aria-hidden="true"
    >
      <div className="ambient-glow-spot ambient-glow-spot--emerald" />
      <div className="ambient-glow-spot ambient-glow-spot--electric" />
    </div>
  );
}
