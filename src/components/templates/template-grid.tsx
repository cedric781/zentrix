"use client";

import { useState } from "react";
import { useTemplates } from "@/hooks/use-templates";
import { TemplateCard } from "./template-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateBetStateOptional } from "@/components/bets/create-bet-context";
import { CategoryTabs } from "@/components/categories/category-tabs";
import {
  CATEGORY_CONFIG,
  type CategorySlug,
} from "@/lib/categories/config";

type Props = {
  navigateOnClick?: boolean;
};

export function TemplateGrid({ navigateOnClick }: Props = {}) {
  const [selectedCategory, setSelectedCategory] = useState<
    CategorySlug | "all"
  >("all");

  const filter =
    selectedCategory === "all"
      ? undefined
      : { category: CATEGORY_CONFIG[selectedCategory].dbValue };

  const { data, isLoading, isError, error } = useTemplates(filter);
  const ctx = useCreateBetStateOptional();
  const selected = ctx?.template ?? null;

  return (
    <div className="space-y-6">
      <CategoryTabs value={selectedCategory} onChange={setSelectedCategory} />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load templates:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      )}

      {data && data.templates.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={!navigateOnClick && selected?.id === t.id}
              navigateOnClick={navigateOnClick}
            />
          ))}
        </div>
      )}

      {data && data.templates.length === 0 && (
        <Alert>
          <AlertDescription>No templates match this filter.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
