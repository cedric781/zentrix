import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BetTemplateSerialized } from "@/lib/api/types";

type Props = {
  template: BetTemplateSerialized;
};

type SchemaProperty = {
  type?: string;
  description?: string;
};

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function getPropertyType(prop: unknown): string {
  if (typeof prop !== "object" || prop === null) return "string";
  const t = (prop as SchemaProperty).type;
  return typeof t === "string" ? t : "string";
}

function getPropertyDescription(prop: unknown): string | undefined {
  if (typeof prop !== "object" || prop === null) return undefined;
  const d = (prop as SchemaProperty).description;
  return typeof d === "string" ? d : undefined;
}

export function TemplateDetail({ template }: Props) {
  const schema =
    typeof template.fieldsSchema === "object" && template.fieldsSchema !== null
      ? (template.fieldsSchema as { properties?: Record<string, unknown> })
      : {};
  const properties = schema.properties ?? {};
  const visibleProperties = Object.entries(properties).filter(
    ([name]) => !name.startsWith("_"),
  );

  return (
    <div className="space-y-8">
      <Link
        href="/templates"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← All templates
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{template.category}</Badge>
          <Badge variant="secondary">{template.settlementType}</Badge>
          {template.supportsAutoResolve && (
            <Badge
              variant="outline"
              title="This template resolves automatically when source data is available"
            >
              Auto-resolves
            </Badge>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{template.name}</h1>
        <p className="text-muted-foreground max-w-2xl">
          {template.resolutionRule}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Bet Parameters</h2>
        {visibleProperties.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No additional parameters required for this template.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visibleProperties.map(([name, prop]) => {
              const description = getPropertyDescription(prop);
              return (
                <div
                  key={name}
                  className="rounded-lg border bg-card px-4 py-3"
                >
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {humanizeKey(name)}
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {getPropertyType(prop)}
                  </div>
                  {description && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="mt-8 pt-6 border-t text-sm text-muted-foreground space-y-2">
        <p>
          Settlement rules are reviewed before you stake. Once a bet is
          accepted, the template rules are locked and cannot be changed by
          either party.
        </p>
      </div>

      <div>
        <Link
          href={`/bets/new?template=${encodeURIComponent(template.slug)}`}
          className="block"
        >
          <Button size="lg" className="w-full sm:w-auto">
            Create Bet with this Template →
          </Button>
        </Link>
      </div>
    </div>
  );
}
