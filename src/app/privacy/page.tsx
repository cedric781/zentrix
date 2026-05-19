import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Zentrix",
  description: "Privacy Policy for the Zentrix peer-to-peer wagering platform.",
};

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Last updated: May 19, 2026
        </p>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Data We Collect</h2>
            <p>We collect the following data when you use Zentrix:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                <strong className="text-foreground">Wallet address</strong> — your Solana embedded wallet
                address (created by Privy) serves as your account identifier
              </li>
              <li>
                <strong className="text-foreground">Email address</strong> — if you sign in via email
                (managed by Privy authentication)
              </li>
              <li>
                <strong className="text-foreground">Wager activity</strong> — records of wagers you
                create, accept, settle, and dispute
              </li>
              <li>
                <strong className="text-foreground">Ledger entries</strong> — balance changes from
                deposits, wagers, settlements, and withdrawals
              </li>
              <li>
                <strong className="text-foreground">Reputation events</strong> — outcomes of wagers
                used to compute your reputation score
              </li>
              <li>
                <strong className="text-foreground">Technical data</strong> — IP address, browser, and
                device information for security and abuse prevention
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. What We Do NOT Collect</h2>
            <p>Zentrix does not collect:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Your private keys (held client-side by Privy)</li>
              <li>Government identification documents (no KYC at this time)</li>
              <li>Banking details (Zentrix uses USDC on Solana, not fiat rails)</li>
              <li>Browsing history outside the Zentrix platform</li>
              <li>Marketing tracking data from third-party advertisers</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How We Use Your Data</h2>
            <p>We use collected data only to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Operate the platform (display balances, match wagers, settle outcomes)</li>
              <li>Authenticate your sessions (via Privy)</li>
              <li>Compute reputation scores from wager outcomes</li>
              <li>Detect fraud, manipulation, or abuse</li>
              <li>Comply with applicable legal requests</li>
            </ul>
            <p className="mt-3">
              We do not sell user data, share it with advertisers, or use it for marketing
              purposes outside Zentrix.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Third-Party Services</h2>
            <p>Zentrix relies on the following third-party services:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                <strong className="text-foreground">Privy</strong> — wallet creation,
                authentication, and key management
              </li>
              <li>
                <strong className="text-foreground">Helius</strong> — Solana RPC and webhook
                infrastructure for blockchain monitoring
              </li>
              <li>
                <strong className="text-foreground">Vercel</strong> — hosting and deployment
              </li>
              <li>
                <strong className="text-foreground">Neon</strong> — managed PostgreSQL database
              </li>
              <li>
                <strong className="text-foreground">ESPN / TheSportsDB</strong> — external event
                data for auto-resolution of sports wagers
              </li>
            </ul>
            <p className="mt-3">
              Each third-party service has its own privacy policy. We share only the minimum data
              necessary for them to provide their service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. On-Chain Data</h2>
            <p>
              USDC transactions on Solana are <strong className="text-foreground">public and permanent</strong>.
              Anyone can observe transfers to and from your wallet address using a Solana block
              explorer. This is a property of public blockchains, not a Zentrix design choice.
            </p>
            <p className="mt-3">
              We recommend treating your Zentrix wallet as pseudonymous. Avoid linking it to your
              real identity (e.g., by tweeting your address) if you want to preserve privacy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Data Retention</h2>
            <p>
              Account data (wallet, email, wager history) is retained for as long as your account
              is active, plus a reasonable period thereafter to handle disputes and meet legal
              obligations. Aggregated and anonymized data may be retained longer for analytics.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Request a copy of your data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your account and associated data</li>
              <li>Object to certain data processing</li>
            </ul>
            <p className="mt-3">
              Note that some data (e.g., on-chain transactions, settled wagers) cannot be deleted
              from the blockchain or fully removed from our ledger without compromising platform
              integrity.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Security</h2>
            <p>
              We use industry-standard practices to protect platform data: encrypted database
              connections, server-side authentication via Privy, parameterized queries to prevent
              injection, and circuit breakers for sensitive operations. However, no system is
              perfectly secure. You are responsible for keeping your Privy login credentials safe.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Cookies &amp; Tracking</h2>
            <p>
              Zentrix uses essential cookies for authentication and session management (via Privy).
              We do not use advertising cookies or third-party tracking pixels.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Children</h2>
            <p>
              Zentrix is not directed to children under 18. We do not knowingly collect data from
              minors. If you believe a minor has used Zentrix, please contact us so we can take
              action.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Changes to This Policy</h2>
            <p>
              We may update this policy. Material changes will be highlighted on the platform.
              Continued use after updates constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Contact</h2>
            <p>
              For privacy-related questions, contact information will be added soon. For now,
              inquiries can be submitted through the platform interface.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
