import Link from "next/link";

export default function TemplateNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Template not found</h1>
      <p className="mt-3 text-muted-foreground">
        This template doesn&apos;t exist, is no longer available, or has been
        deactivated.
      </p>
      <Link
        href="/templates"
        className="mt-8 inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
      >
        ← Browse all templates
      </Link>
    </main>
  );
}
