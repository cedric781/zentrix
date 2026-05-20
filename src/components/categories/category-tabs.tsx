"use client";

import { cn } from "@/lib/utils";
import {
  CATEGORY_CONFIG,
  VISIBLE_CATEGORIES,
  type CategorySlug,
} from "@/lib/categories/config";

type Props = {
  /** Selected slug or "all" */
  value: CategorySlug | "all";
  /** Called with new value on click */
  onChange: (value: CategorySlug | "all") => void;
  /** Show "All" tab as first option */
  includeAll?: boolean;
  /** Layout: pills (default) or compact */
  variant?: "pills" | "compact";
  className?: string;
};

export function CategoryTabs({
  value,
  onChange,
  includeAll = true,
  variant = "pills",
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex gap-2 overflow-x-auto",
        "[scrollbar-width:none] [-ms-overflow-style:none]",
        "[&::-webkit-scrollbar]:hidden",
        className,
      )}
      role="tablist"
      aria-label="Categories"
    >
      {includeAll && (
        <TabButton
          isActive={value === "all"}
          onClick={() => onChange("all")}
          variant={variant}
        >
          All
        </TabButton>
      )}

      {VISIBLE_CATEGORIES.map((slug) => {
        const config = CATEGORY_CONFIG[slug];
        const Icon = config.icon;
        const isActive = value === slug;

        return (
          <TabButton
            key={slug}
            isActive={isActive}
            onClick={() => onChange(slug)}
            variant={variant}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{config.label}</span>
          </TabButton>
        );
      })}
    </div>
  );
}

type TabButtonProps = {
  isActive: boolean;
  onClick: () => void;
  variant: "pills" | "compact";
  children: React.ReactNode;
};

function TabButton({ isActive, onClick, variant, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={isActive}
      className={cn(
        "shrink-0 inline-flex items-center gap-2 rounded-full font-mono text-xs uppercase tracking-wider transition-all whitespace-nowrap",
        variant === "pills" ? "px-4 py-2" : "px-3 py-1.5",
        isActive
          ? "bg-[var(--brand)] text-[var(--background)] shadow-[0_0_20px_oklch(from_var(--brand)_l_c_h_/_0.3)]"
          : "bg-[var(--surface-container)] text-muted-foreground hover:bg-[var(--surface-container-high)] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
