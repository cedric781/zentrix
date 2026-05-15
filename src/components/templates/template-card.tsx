"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCreateBetState } from "@/components/bets/create-bet-context";
import type { BetTemplateSerialized } from "@/lib/api/types";

type Props = {
  template: BetTemplateSerialized;
  selected: boolean;
};

export function TemplateCard({ template, selected }: Props) {
  const { setTemplate } = useCreateBetState();

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={`cursor-pointer transition-all hover:shadow-md ${
        selected ? "ring-2 ring-primary" : ""
      }`}
      onClick={() => setTemplate(template)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setTemplate(template);
        }
      }}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base">{template.name}</CardTitle>
            {template.supportsAutoResolve && (
              <Badge
                variant="secondary"
                className="shrink-0 text-xs font-normal text-muted-foreground"
              >
                Auto-resolves
              </Badge>
            )}
          </div>
          <Badge variant="outline" className="shrink-0">
            {template.category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2">
          {template.resolutionRule}
        </p>
      </CardContent>
    </Card>
  );
}
