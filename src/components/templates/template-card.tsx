"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCreateBetStateOptional } from "@/components/bets/create-bet-context";
import type { BetTemplateSerialized } from "@/lib/api/types";

type Props = {
  template: BetTemplateSerialized;
  selected: boolean;
  navigateOnClick?: boolean;
};

export function TemplateCard({ template, selected, navigateOnClick }: Props) {
  const router = useRouter();
  const ctx = useCreateBetStateOptional();

  const handleActivate = () => {
    if (navigateOnClick) {
      router.push(`/templates/${encodeURIComponent(template.slug)}`);
      return;
    }
    ctx?.setTemplate(template);
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={`card-glow card-gradient-surface rounded-xl border border-[var(--outline-variant)]/60 hover:border-[var(--brand)]/50 shadow-2xl cursor-pointer transition-all ${
        selected ? "ring-2 ring-[var(--brand)]" : ""
      }`}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
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
