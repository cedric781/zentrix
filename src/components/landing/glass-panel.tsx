import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  milled?: boolean;
  borderAccent?: "emerald" | "none";
};

export function GlassPanel({
  className,
  milled = false,
  borderAccent = "none",
  children,
  ...rest
}: Props) {
  return (
    <div
      className={cn(
        "glass-panel rounded-2xl",
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
