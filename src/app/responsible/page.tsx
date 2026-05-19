import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Responsible Gaming | Zentrix",
  description: "Play responsibly on Zentrix. Know your limits and get help if needed.",
};

export default function ResponsiblePage() {
  return (
    <main className="min-h-screen pt-12 pb-16">
      <div className="max-w-3xl mx-auto px-4 md:px-8">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 inline-block"
        >
          ← Back to Home
        </Link>

        <h1 className="text-3xl md:text-4xl font-bold mb-2">
          Play Responsibly
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Zentrix is designed for entertainment. Please use the platform responsibly.
        </p>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Know Your Limits</h2>
            <ul className="space-y-3">
              <li className="flex gap-3">
                <span className="text-foreground font-bold shrink-0">1.</span>
                <span>
                  <strong className="text-foreground">Set a budget.</strong> Only wager what you
                  can afford to lose. Never use money you need for rent, bills, food, or other
                  essentials.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-foreground font-bold shrink-0">2.</span>
                <span>
                  <strong className="text-foreground">Set a time limit.</strong> Decide before
                  you start how long you will spend on the platform. Stop when you reach that
                  limit, regardless of whether you are winning or losing.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-foreground font-bold shrink-0">3.</span>
                <span>
                  <strong className="text-foreground">Never chase losses.</strong> If you lose, do
                  not increase your stake to try to win back what you lost. This is one of the
                  most dangerous gambling patterns.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-foreground font-bold shrink-0">4.</span>
                <span>
                  <strong className="text-foreground">Take breaks.</strong> Step away from the
                  platform regularly. Wagering should be one of many activities, not a daily
                  habit.
                </span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Warning Signs</h2>
            <p className="mb-3">
              Wagering may be becoming a problem if you:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Spend more time or money than you planned</li>
              <li>Borrow money or sell things to fund wagers</li>
              <li>Lie to family or friends about your activity</li>
              <li>Feel anxious, restless, or depressed when not wagering</li>
              <li>Neglect work, school, or relationships</li>
              <li>Try to win back losses by increasing stakes</li>
              <li>Cannot stop even when you want to</li>
            </ul>
            <p className="mt-3">
              If any of these apply to you, please consider reaching out to a support resource
              listed below.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Crypto-Specific Risks</h2>
            <p className="mb-3">
              Wagering with cryptocurrency adds unique risks beyond traditional gambling:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong className="text-foreground">Irreversible transactions.</strong> Once USDC
                leaves your wallet on the Solana network, it cannot be recovered.
              </li>
              <li>
                <strong className="text-foreground">Address mistakes.</strong> Sending funds to a
                wrong wallet address results in permanent loss.
              </li>
              <li>
                <strong className="text-foreground">Phishing &amp; scams.</strong> Never share your
                wallet seed phrase. Zentrix will never ask for it.
              </li>
              <li>
                <strong className="text-foreground">Volatility &amp; stablecoin risk.</strong> USDC
                aims to track the US Dollar, but no stablecoin is risk-free. Issuer or technical
                failures can affect value.
              </li>
              <li>
                <strong className="text-foreground">24/7 availability.</strong> Crypto wallets
                never close. This convenience can encourage compulsive behavior. Set hard limits
                for yourself.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Self-Help Tools</h2>
            <p className="mb-3">
              Some practical steps you can take right now:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Withdraw your balance to an external wallet you do not check daily</li>
              <li>Remove the Zentrix bookmark and uninstall the Solana wallet app temporarily</li>
              <li>Ask a trusted person to hold your seed phrase, making the wallet harder to access</li>
              <li>Track your wagering with a journal — write down each session, win/loss, and feelings</li>
              <li>Block gambling-related sites and apps using browser tools or apps like Gamban</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Get Help</h2>
            <p className="mb-3">
              If you or someone you know is struggling with gambling, free and confidential help
              is available:
            </p>
            <ul className="space-y-3">
              <li>
                <strong className="text-foreground">Netherlands:</strong>{" "}
                <a
                  href="https://www.agog.nl/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  AGOG (Anonieme Gokkers Omgeving Gokkers)
                </a>{" "}
                — Anonieme zelfhulp voor problematische gokkers
              </li>
              <li>
                <strong className="text-foreground">Netherlands:</strong>{" "}
                <a
                  href="https://loketkansspel.nl/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Loket Kansspel
                </a>{" "}
                — Information and support from the Kansspelautoriteit
              </li>
              <li>
                <strong className="text-foreground">International:</strong>{" "}
                <a
                  href="https://www.begambleaware.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  BeGambleAware
                </a>{" "}
                — Free, confidential support and treatment referrals (English)
              </li>
              <li>
                <strong className="text-foreground">International:</strong>{" "}
                <a
                  href="https://www.gamblersanonymous.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Gamblers Anonymous
                </a>{" "}
                — 12-step recovery program with meetings worldwide
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Age Restriction</h2>
            <p>
              You must be at least 18 years old (or the legal age of majority in your jurisdiction,
              whichever is higher) to use Zentrix. If you are under 18, please leave the platform.
              If you suspect a minor is using Zentrix, please contact us.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Our Commitment</h2>
            <p>
              Zentrix is built as a peer-to-peer wagering platform — not a casino. We do not
              employ retention tactics, bonuses, or other mechanisms designed to encourage
              excessive play. We aim to make wagering predictable and transparent. If you ever
              feel the platform is contributing to a problem, please step away.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
