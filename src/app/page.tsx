"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Wallet, CheckCircle, ArrowRight } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { FAQ } from "@/components/landing/faq";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

export default function LandingPage() {
  const { authenticated } = usePrivy();
  const ctaHref = authenticated ? "/bets/new" : "/signin";

  return (
    <div className="min-h-screen bg-[#0b0b0b]">

      {/* ═══ HERO ═══ */}
      <div className="relative w-full overflow-hidden aspect-[16/9] sm:aspect-[2/1] lg:aspect-[5/2]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/zentrix-hero.png"
          alt="Friends reacting to a bet"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />

        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.85))" }}
        />
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-b from-transparent to-[#0b0b0b]" />

        <div className="absolute inset-0 z-10 flex items-end max-w-7xl mx-auto px-6 md:px-12 pb-10 md:pb-16">
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="max-w-xl space-y-5"
          >
            <motion.h1
              variants={fadeUp}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.08]"
            >
              Bet on anything.{" "}
              <span className="text-[#2563EB]">Winner takes the pot.</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-base sm:text-lg text-white/70 leading-relaxed max-w-md"
            >
              Pick a side, set the stakes, settle with real outcomes. No house, no odds.
              Just you and your opponent on Solana.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3 pt-4">
              <Link href={ctaHref} className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="bg-[#2563EB] hover:bg-[#2563EB]/90 text-white border-none rounded-xl text-base px-8 py-3.5 w-full"
                >
                  Create Bet
                </Button>
              </Link>
              <Link href="/feed" className="w-full sm:w-auto">
                <Button
                  variant="secondary"
                  size="lg"
                  className="border-white/20 text-white hover:bg-white/10 rounded-xl text-base px-8 py-3.5 w-full bg-transparent"
                >
                  Explore Bets
                </Button>
              </Link>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="flex flex-col sm:flex-row gap-4 sm:gap-6 pt-4 text-white/50"
            >
              {[
                { icon: Shield, label: "USDC on Solana" },
                { icon: Wallet, label: "2% fee on wins only" },
                { icon: CheckCircle, label: "Withdraw anytime" },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="flex items-center gap-2 text-xs font-mono">
                  <Icon className="w-3.5 h-3.5 text-white/40" />
                  {label}
                </span>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="relative z-20 bg-[#0b0b0b] pt-12 md:pt-16 pb-16">
        <div className="max-w-4xl mx-auto px-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { step: "1", title: "Create a bet", desc: "Pick a template, set conditions and stake." },
              { step: "2", title: "Fund your bet", desc: "Deposit USDC. Held in escrow until outcome." },
              { step: "3", title: "Winner gets paid", desc: "Auto-resolved or confirmed. Pot transfers instantly." },
            ].map(({ step, title, desc }) => (
              <div
                key={step}
                className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 text-center space-y-2"
              >
                <div className="w-10 h-10 mx-auto rounded-full bg-[#2563EB]/15 flex items-center justify-center">
                  <span className="text-[#2563EB] font-bold text-sm">{step}</span>
                </div>
                <h3 className="text-base font-semibold text-white">{title}</h3>
                <p className="text-sm text-white/60">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FEATURES TRUST BAR ═══ */}
      <section className="py-12 md:py-16 border-y border-white/10 bg-white/[0.02]">
        <div className="max-w-4xl mx-auto px-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Funds secured", sub: "Held in escrow on-chain" },
              { label: "Transparent rules", sub: "Templates define outcome" },
              { label: "Auto-settled", sub: "ESPN + TheSportsDB" },
              { label: "Fair disputes", sub: "10% stake, neutral reviewer" },
            ].map(({ label, sub }) => (
              <div key={label} className="text-center space-y-0.5">
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-xs text-white/50">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TEMPLATES PREVIEW ═══ */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-white text-center mb-8">
            Popular bets
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { name: "Match Winner", cat: "Sports" },
              { name: "Boxing Winner", cat: "Combat" },
              { name: "MMA Winner", cat: "Combat" },
              { name: "CS2 Match", cat: "Esports" },
              { name: "1v1 Chess", cat: "Games" },
              { name: "Custom Bet", cat: "Anything" },
            ].map(({ name, cat }) => (
              <Link
                key={name}
                href="/bets/new"
                className="bg-white/[0.03] border border-white/10 hover:border-[#2563EB]/50 transition-colors rounded-xl px-4 py-3 flex items-center justify-between group"
              >
                <div>
                  <p className="text-sm font-medium text-white">{name}</p>
                  <p className="text-xs text-white/50">{cat}</p>
                </div>
                <ArrowRight size={14} className="text-[#2563EB] group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SOCIAL IMAGE ═══ */}
      <section className="py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-4">
          <div className="relative w-full overflow-hidden rounded-2xl bg-neutral-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/zentrix-social.jpg"
              alt="Two phones placing a bet in a stadium"
              className="w-full h-auto object-contain"
            />
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <div className="bg-[#0b0b0b]">
        <FAQ />
      </div>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-16 md:py-20">
        <div className="max-w-md mx-auto px-4 text-center space-y-5">
          <h2 className="text-2xl font-bold text-white">Ready to bet?</h2>
          <p className="text-sm text-white/60">
            Create your first bet in under a minute.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link href={ctaHref} className="w-full sm:w-auto">
              <Button
                size="lg"
                className="bg-[#2563EB] hover:bg-[#2563EB]/90 text-white border-none w-full"
              >
                {authenticated ? "Create Bet" : "Get Started"}
              </Button>
            </Link>
            <Link href="/feed" className="w-full sm:w-auto">
              <Button
                variant="secondary"
                size="lg"
                className="w-full border-white/20 text-white hover:bg-white/10 bg-transparent"
              >
                Browse Bets
              </Button>
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
