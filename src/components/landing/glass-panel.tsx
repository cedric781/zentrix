import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  milled?: boolean;
  borderAccent?: "emerald" | "none";
  /** Visual density — "default" is solid glass, "refined" is more transparent */
  variant?: "default" | "refined";
};

export function GlassPanel({
  className,
  milled = false,
  borderAccent = "none",
  variant = "default",
  children,
  ...rest
}: Props) {
  return (
    <div
      className={cn(
        variant === "refined" ? "glass-panel-refined" : "glass-panel",
        "rounded-2xl",
        milled && "milled-border",
        borderAccent === "emerald" &&
          "border-l-4 border-l-[var(--emerald-accent)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
