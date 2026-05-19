"use client";

import { AuthGuard } from "@/components/auth-guard";
import { TemplateGrid } from "@/components/templates/template-grid";

export default function TemplatesPage() {
  return (
    <AuthGuard>
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">Pick your bet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse templates by category. Click one to start creating a bet.
          </p>
        </div>

        <TemplateGrid navigateOnClick />
      </main>
    </AuthGuard>
  );
}
