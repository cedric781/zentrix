"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  const { authenticated } = usePrivy();
  const ctaHref = authenticated ? "/bets/new" : "/signin";

  return (
    <section className="py-16 md:py-20">
      <div className="max-w-md mx-auto px-4 text-center space-y-5">
        <h2 className="font-display text-2xl font-bold">Ready to bet?</h2>
        <p className="text-sm text-muted-foreground">
          Create your first bet in under a minute.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link href={ctaHref} className="w-full sm:w-auto">
            <Button
              size="lg"
              className="bg-[var(--brand)] hover:bg-[var(--brand)]/90 text-[var(--brand-foreground)] border-none w-full"
            >
              {authenticated ? "Create Bet" : "Get Started"}
            </Button>
          </Link>
          <Link href="/feed" className="w-full sm:w-auto">
            <Button variant="outline" size="lg" className="w-full">
              Browse Bets
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
