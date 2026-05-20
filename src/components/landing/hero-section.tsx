"use client";

import Link from "next/link";
import { Shield, Wallet, CheckCircle } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

export function HeroSection() {
  const { authenticated } = usePrivy();
  const ctaHref = authenticated ? "/bets/new" : "/signin";

  return (
    <section className="relative h-[500px] md:h-[600px] flex items-center overflow-hidden bg-[var(--background-deep)]">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--surface-container-low)] via-[var(--background)] to-[var(--background-deep)]" />
        <div className="absolute inset-0 hero-gradient-overlay z-10" />
      </div>

      <div className="relative z-20 w-full px-6 md:px-10 max-w-7xl mx-auto">
        <div className="max-w-xl space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--brand)]/10 border border-[var(--brand)]/20 text-[var(--brand)]">
            <span className="text-xs font-mono uppercase tracking-wider">
              Peer-to-peer · Solana
            </span>
          </div>

          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08]">
            Bet on anything.{" "}
            <span className="text-[var(--brand)]">
              Winner takes the pot.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-md">
            Pick a side, set the stakes, settle with real outcomes. No house, no
            odds. Just you and your opponent on Solana.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Link href={ctaHref} className="w-full sm:w-auto">
              <Button
                size="lg"
                className="bg-[var(--brand)] hover:bg-[var(--brand)]/90 text-[var(--brand-foreground)] border-none rounded-xl text-base px-8 py-3.5 w-full"
              >
                Create Bet
              </Button>
            </Link>
            <Link href="/feed" className="w-full sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="rounded-xl text-base px-8 py-3.5 w-full"
              >
                Explore Bets
              </Button>
            </Link>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 pt-4 text-muted-foreground">
            {[
              { icon: Shield, label: "USDC on Solana" },
              { icon: Wallet, label: "2% fee on wins only" },
              { icon: CheckCircle, label: "Withdraw anytime" },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="flex items-center gap-2 text-xs font-mono"
              >
                <Icon className="w-3.5 h-3.5 opacity-70" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
