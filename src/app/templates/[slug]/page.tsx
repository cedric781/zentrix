import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTemplate } from "@/lib/templates/service";
import { serializeTemplate } from "@/lib/http/serialize";
import { TemplateDetail } from "@/components/templates/template-detail";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const template = await getTemplate(slug).catch(() => null);

  if (!template) {
    return {
      title: "Template Not Found · Zentrix",
      robots: { index: false, follow: false },
    };
  }

  const description =
    template.resolutionRule?.slice(0, 160) ??
    `${template.category} bet template on Zentrix`;

  return {
    title: `${template.name} · Zentrix`,
    description,
    openGraph: {
      title: template.name,
      description,
      type: "website",
    },
    robots: { index: true, follow: true },
  };
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const template = await getTemplate(slug);
  if (!template) {
    notFound();
  }

  const serialized = serializeTemplate(template);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <TemplateDetail template={serialized} />
    </main>
  );
}
