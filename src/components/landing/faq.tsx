"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "How does Zentrix work?",
    a: "Create a bet by picking a template and setting conditions. Your opponent accepts by matching the stake in USDC. After the event, the result is verified—either auto-resolved via official scoreboards or confirmed by both parties. The winner gets the pot.",
  },
  {
    q: "What currencies are supported?",
    a: "Zentrix uses USDC on Solana. Fast settlement, low fees, and no fiat conversion needed. Deposits and withdrawals happen via your embedded wallet.",
  },
  {
    q: "Who decides who wins?",
    a: "For sports and verified events, results come from official APIs (ESPN, TheSportsDB). For custom bets, both parties confirm the outcome. If you disagree, open a dispute—a neutral reviewer decides for a 10% stake fee.",
  },
  {
    q: "What are the fees?",
    a: "2% on wins only. No deposit fees, no withdrawal fees beyond Solana network costs.",
  },
  {
    q: "What happens if my opponent doesn't show up?",
    a: "Bets have an expiry time. If no one accepts before expiry, your stake is automatically refunded. If your opponent ghosts after accepting, you can claim the result after the dispute window.",
  },
  {
    q: "Can I cancel a bet after it's accepted?",
    a: "No. Once both parties have funded the bet, it's locked in escrow until the event resolves. This protects both sides.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="py-16 md:py-20 px-4 max-w-3xl mx-auto">
      <h2 className="text-2xl md:text-3xl font-bold text-center mb-10 text-white">
        Questions, answered.
      </h2>
      <div className="space-y-3">
        {FAQS.map((faq, i) => {
          const open = openIndex === i;
          return (
            <div
              key={faq.q}
              className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden transition-colors"
            >
              <button
                onClick={() => setOpenIndex(open ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/5 transition-colors"
                aria-expanded={open}
              >
                <span className="text-sm font-medium text-white">{faq.q}</span>
                <ChevronDown
                  size={16}
                  className={cn(
                    "shrink-0 text-white/40 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
              {open && (
                <div className="px-5 pb-4 text-sm text-white/60 leading-relaxed">
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
