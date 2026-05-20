import { listTemplates } from "@/lib/templates/service";
import { serializeTemplate } from "@/lib/http/serialize";
import { FAQ } from "@/components/landing/faq";
import { HeroSection } from "@/components/landing/hero-section";
import { TemplateBento } from "@/components/landing/template-bento";
import { GlassPanel } from "@/components/landing/glass-panel";
import { FinalCta } from "@/components/landing/final-cta";
import { AmbientGlow } from "@/components/landing/ambient-glow";

export default async function LandingPage() {
  const templates = await listTemplates({ activeOnly: true });
  const serialized = templates.slice(0, 5).map(serializeTemplate);

  return (
    <div className="min-h-screen landing-bg-gradient relative">
      <AmbientGlow />
      <div className="relative z-10">
      <HeroSection />

      {/* ═══ HOW IT WORKS ═══ */}
      <section
        id="how-it-works"
        className="py-16 px-4 md:px-10 max-w-7xl mx-auto"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Create a bet",
              desc: "Pick a template, set conditions and stake.",
            },
            {
              step: "2",
              title: "Fund your bet",
              desc: "Deposit USDC. Held in escrow until outcome.",
            },
            {
              step: "3",
              title: "Winner gets paid",
              desc: "Auto-resolved or confirmed. Pot transfers instantly.",
            },
          ].map(({ step, title, desc }) => (
            <GlassPanel
              key={step}
              className="p-6 text-center space-y-2"
              milled
            >
              <div className="w-10 h-10 mx-auto rounded-full bg-[var(--brand)]/15 flex items-center justify-center">
                <span className="text-[var(--brand)] font-bold text-sm">
                  {step}
                </span>
              </div>
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </GlassPanel>
          ))}
        </div>
      </section>

      {/* ═══ TEMPLATES ═══ */}
      <section
        id="templates"
        className="py-16 px-4 md:px-10 max-w-7xl mx-auto"
      >
        <h2 className="font-display text-3xl md:text-4xl font-bold mb-8 text-center">
          Popular bets
        </h2>
        <TemplateBento templates={serialized} />
      </section>

      {/* ═══ FEATURES TRUST BAR ═══ */}
      <section className="py-16 px-4 md:px-10 max-w-7xl mx-auto">
        <GlassPanel className="px-6 py-8 md:px-10 md:py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Funds secured", sub: "Held in escrow on-chain" },
              { label: "Transparent rules", sub: "Templates define outcome" },
              { label: "Auto-settled", sub: "ESPN + TheSportsDB" },
              { label: "Fair disputes", sub: "10% stake, neutral reviewer" },
            ].map(({ label, sub }) => (
              <div key={label} className="text-center space-y-0.5">
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </section>

      {/* ═══ SOCIAL IMAGE ═══ */}
      <section className="py-12 md:py-16 px-4 md:px-10 max-w-5xl mx-auto">
        <div className="relative w-full overflow-hidden rounded-2xl bg-neutral-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/zentrix-social.jpg"
            alt="Two phones placing a bet in a stadium"
            className="w-full h-auto object-contain"
          />
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <FAQ />

      {/* ═══ FINAL CTA ═══ */}
      <FinalCta />
      </div>
    </div>
  );
}
