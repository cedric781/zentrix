"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AmbientGlow } from "@/components/landing/ambient-glow";
import { Button } from "@/components/ui/button";
import { PoolList } from "@/components/pools/pool-list";

export default function PoolsPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen landing-bg-gradient relative">
        <AmbientGlow />
        <main className="relative z-10 mx-auto max-w-7xl px-4 md:px-10 py-12">
          <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[var(--brand)] font-mono text-[11px] uppercase tracking-widest mb-2 block">
                Live Markets
              </span>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight font-display">
                Active pools
              </h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Discover open pools across all events.
              </p>
            </div>
            <Button asChild size="sm" className="gap-1.5 self-start md:self-auto">
              <Link href="/pools/new">
                <Plus size={14} />
                Create pool
              </Link>
            </Button>
          </header>

          <PoolList />
        </main>
      </div>
    </AuthGuard>
  );
}
