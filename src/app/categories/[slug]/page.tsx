import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatUsdc } from "@/lib/money/units";
import { getCategoryBySlug } from "@/lib/categories/config";
import { listTemplates } from "@/lib/templates/service";
import { serializeTemplate } from "@/lib/http/serialize";
import { TemplateBento } from "@/components/landing/template-bento";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);

  if (!category) {
    return {
      title: "Category not found · Zentrix",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${category.label} bets · Zentrix`,
    description: category.description,
    openGraph: {
      title: `${category.label} on Zentrix`,
      description: category.description,
      type: "website",
    },
  };
}

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  const [templates, openBets] = await Promise.all([
    listTemplates({ category: category.dbValue, activeOnly: true }),
    prisma.bet.findMany({
      where: {
        category: category.dbValue,
        status: "OPEN",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const Icon = category.icon;
  const serializedTemplates = templates.map(serializeTemplate);

  return (
    <main className="mx-auto max-w-7xl px-4 md:px-10 py-12">
      <Link
        href="/templates"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
      >
        <ArrowLeft className="size-4" />
        All categories
      </Link>

      <header className="mb-12 flex items-start gap-6">
        <div className="p-4 bg-[var(--brand)]/10 rounded-2xl text-[var(--brand)] shrink-0">
          <Icon className="size-12" aria-hidden="true" />
        </div>
        <div>
          <span className="text-[var(--brand)] font-mono text-[11px] uppercase tracking-widest block mb-1">
            Category
          </span>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-2">
            {category.label}
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            {category.description}
          </p>
        </div>
      </header>

      <section className="mb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Templates in {category.label}
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {serializedTemplates.length}{" "}
            {serializedTemplates.length === 1 ? "template" : "templates"}
          </span>
        </div>

        {serializedTemplates.length > 0 ? (
          <TemplateBento templates={serializedTemplates} />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground">
              No templates available in this category yet.
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Open bets in {category.label}
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {openBets.length} active
          </span>
        </div>

        {openBets.length > 0 ? (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-[var(--surface-container-high)]">
                <tr>
                  <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Bet
                  </th>
                  <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground text-right">
                    Stake
                  </th>
                  <th className="px-6 py-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {openBets.map((bet) => (
                  <tr
                    key={bet.id}
                    className="hover:bg-[var(--surface-container)] transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium">
                        {bet.title ||
                          `${bet.creatorSide} vs ${bet.acceptorSide ?? "?"}`}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        #{bet.id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono tabular-nums">
                      {formatUsdc(bet.stakeUnits)} USDC
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/bets/${bet.id}`}
                        className="inline-block px-4 py-1.5 rounded bg-[var(--brand)] text-[var(--background)] text-xs font-bold hover:brightness-110 transition-all"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground">
              No open bets in this category yet.{" "}
              <Link
                href="/bets/new"
                className="text-[var(--brand)] hover:underline"
              >
                Create the first one
              </Link>
              .
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
