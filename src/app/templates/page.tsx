"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AmbientGlow } from "@/components/landing/ambient-glow";
import { TemplateGrid } from "@/components/templates/template-grid";

export default function TemplatesPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen landing-bg-gradient relative">
        <AmbientGlow />
        <main className="relative z-10 mx-auto max-w-7xl px-4 md:px-10 py-12">
          <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[var(--brand)] font-mono text-[11px] uppercase tracking-widest mb-2 block">
                Pick your bet
              </span>
              <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
                Browse templates by category
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Choose a template, set your stake, and challenge an opponent.
              </p>
            </div>
          </header>

          <TemplateGrid navigateOnClick />
        </main>
      </div>
    </AuthGuard>
  );
}
