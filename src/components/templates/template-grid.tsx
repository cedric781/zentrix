"use client";

import { useState } from "react";
import { useTemplates } from "@/hooks/use-templates";
import { TemplateCard } from "./template-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useCreateBetState } from "@/components/bets/create-bet-context";

const CATEGORIES = ["All", "Sport", "Combat", "Esports", "Games"] as const;

export function TemplateGrid() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const filter = category === "All" ? undefined : { category };
  const { data, isLoading, isError, error } = useTemplates(filter);
  const { template: selected } = useCreateBetState();

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <Badge
            key={c}
            variant={category === c ? "default" : "outline"}
            className="cursor-pointer select-none"
            onClick={() => setCategory(c)}
          >
            {c}
          </Badge>
        ))}
      </div>

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
            Failed to load templates: {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      )}

      {data && data.templates.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={selected?.id === t.id}
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
