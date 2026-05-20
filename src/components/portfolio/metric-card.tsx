import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string;
  icon?: LucideIcon;
  hint?: string;
  /** Optional progress bar 0-100 (for percentages) */
  progress?: number;
  /** Color emphasis voor value */
  valueAccent?: "default" | "brand";
  className?: string;
};

export function MetricCard({
  label,
  value,
  icon: Icon,
  hint,
  progress,
  valueAccent = "default",
  className,
}: Props) {
  return (
    <div
      className={cn(
        "glass-panel rounded-xl p-6 border border-[var(--outline-variant)]/40 transition-colors hover:border-[var(--brand)]/30",
        className,
      )}
    >
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
        {label}
      </p>
      <h3
        className={cn(
          "text-[28px] font-bold tracking-tight font-display mb-1",
          valueAccent === "brand" ? "text-[var(--brand)]" : "text-foreground",
        )}
      >
        {value}
      </h3>
      {hint && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {Icon && <Icon className="size-4 text-[var(--brand)]" aria-hidden="true" />}
          <span>{hint}</span>
        </div>
      )}
      {typeof progress === "number" && (
        <div className="w-full bg-[var(--surface-container-low)]/50 h-1.5 rounded-full mt-3 overflow-hidden border border-[var(--outline-variant)]/20">
          <div
            className="bg-[var(--brand)] h-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  );
}
