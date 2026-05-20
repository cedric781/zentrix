import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "./glass-panel";
import { BentoGrid, BentoItem } from "./bento-grid";
import type { BetTemplateSerialized } from "@/lib/api/types";

type Props = {
  templates: BetTemplateSerialized[];
};

export function TemplateBento({ templates }: Props) {
  if (templates.length === 0) {
    return (
      <GlassPanel className="p-8 text-center">
        <p className="text-muted-foreground">No templates available yet.</p>
      </GlassPanel>
    );
  }

  const [featured, ...rest] = templates;
  const smaller = rest.slice(0, 4);

  return (
    <BentoGrid>
      <BentoItem span={8}>
        <Link
          href={`/templates/${encodeURIComponent(featured.slug)}`}
          className="block h-full"
        >
          <GlassPanel className="h-full overflow-hidden group hover:border-[var(--brand)]/40 transition-colors p-6 flex flex-col justify-between min-h-[280px]">
            <div>
              <Badge variant="secondary" className="font-mono text-[10px] mb-3">
                {featured.category}
              </Badge>
              <h3 className="font-display text-2xl font-bold mb-2">
                {featured.name}
              </h3>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                {featured.resolutionRule ?? ""}
              </p>
            </div>
            <div className="text-[var(--brand)] text-sm font-mono uppercase tracking-wider">
              View template →
            </div>
          </GlassPanel>
        </Link>
      </BentoItem>

      {smaller.map((tpl) => (
        <BentoItem span={4} key={tpl.slug}>
          <Link
            href={`/templates/${encodeURIComponent(tpl.slug)}`}
            className="block h-full"
          >
            <GlassPanel className="h-full p-4 hover:-translate-y-1 transition-transform cursor-pointer min-h-[180px]">
              <Badge variant="outline" className="font-mono text-[10px] mb-3">
                {tpl.category}
              </Badge>
              <h4 className="font-semibold text-sm mb-1">{tpl.name}</h4>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {tpl.resolutionRule ?? ""}
              </p>
            </GlassPanel>
          </Link>
        </BentoItem>
      ))}
    </BentoGrid>
  );
}
