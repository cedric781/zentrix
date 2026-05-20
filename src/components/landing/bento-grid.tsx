import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function BentoGrid({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("bento-grid", className)} {...rest}>
      {children}
    </div>
  );
}

type BentoSpan = "full" | 4 | 6 | 8 | 12;

type BentoItemProps = HTMLAttributes<HTMLDivElement> & {
  span?: BentoSpan;
};

const SPAN_CLASS: Record<BentoSpan, string> = {
  full: "col-span-full",
  4: "col-span-full md:col-span-4 lg:col-span-4",
  6: "col-span-full md:col-span-4 lg:col-span-6",
  8: "col-span-full lg:col-span-8",
  12: "col-span-full lg:col-span-12",
};

export function BentoItem({
  span = 4,
  className,
  children,
  ...rest
}: BentoItemProps) {
  return (
    <div className={cn(SPAN_CLASS[span], className)} {...rest}>
      {children}
    </div>
  );
}
