import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Zentrix",
  description: "Terms of Service for the Zentrix peer-to-peer wagering platform.",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Last updated: May 19, 2026
        </p>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Platform Description</h2>
            <p>
              Zentrix is a peer-to-peer (P2P) wagering platform that allows users to create
              contracts with objective, verifiable outcomes. Zentrix is{" "}
              <strong className="text-foreground">not a casino</strong>, does not operate as a
              bookmaker, and does not take a position on any wager. There is no house edge.
              The platform provides a user interface for two parties to define terms and settle
              wagers via USDC on the Solana blockchain.
            </p>
            <p className="mt-3">
              Wallets are managed by Privy as non-custodial embedded wallets. The platform operator
              (&quot;Yung Gado&quot;) does not hold user funds. Wager funds are tracked via an internal
              ledger and settled directly between participants&apos; wallets.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Eligibility</h2>
            <p>
              You must be at least 18 years old (or the legal age of majority in your jurisdiction,
              whichever is higher) to use Zentrix. You are responsible for ensuring that your use
              of the platform is legal in your country, state, or region of residence.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Wagers</h2>
            <p>
              A wager on Zentrix is a binding contract between two parties. When you create or
              accept a wager:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Your USDC stake is debited from your available balance immediately</li>
              <li>Funds are held in escrow until the wager resolves</li>
              <li>The winner receives both stakes minus any platform fees</li>
              <li>You cannot unilaterally cancel an accepted wager</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Settlement &amp; Disputes</h2>
            <p>
              Wagers settle when both parties confirm the outcome. If the parties disagree, either
              may open a dispute. The platform operator acts as arbiter for disputed wagers and
              has final authority on disputed outcomes. Decisions are based on official, verifiable
              sources where applicable (e.g., ESPN scoreboards for sports outcomes).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Fees</h2>
            <p>
              Zentrix charges fees on certain transactions. Current fees:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Bet creation: 2% of stake (deducted at create time)</li>
              <li>Withdrawal: a network fee covering Solana transaction costs</li>
              <li>Dispute resolution: 15% of pot, deducted on resolution</li>
            </ul>
            <p className="mt-3">
              Fees may change. Current fees are always shown before you confirm any action.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Funds &amp; Withdrawals</h2>
            <p>
              You may withdraw your available balance to any Solana wallet at any time, subject to
              minimum withdrawal amounts and the platform&apos;s recon checks. Withdrawals are
              irreversible once submitted to the Solana network. Verify destination addresses
              carefully — funds sent to incorrect addresses cannot be recovered.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Risks</h2>
            <p>
              Cryptocurrency transactions are irreversible. USDC value, while typically stable, is
              subject to market and counterparty risk. Smart contracts and blockchain protocols may
              contain bugs or vulnerabilities. You assume all risk of loss when using Zentrix.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Prohibited Conduct</h2>
            <p>You may not:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Create wagers based on illegal activities or harm</li>
              <li>Manipulate outcomes or collude with counterparties</li>
              <li>Use the platform on behalf of another person without authorization</li>
              <li>Attempt to circumvent platform fees or security mechanisms</li>
              <li>Use Zentrix while underage or in violation of your local law</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Account Suspension</h2>
            <p>
              The operator may suspend or terminate accounts that violate these terms. Suspended
              accounts retain ledger balances; affected users may request withdrawal of remaining
              balance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Disclaimer</h2>
            <p>
              Zentrix is provided &quot;as is&quot; without warranties of any kind. The operator
              is not liable for losses arising from technical failures, blockchain congestion,
              third-party services (including Privy and Solana RPC providers), or user error.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Changes</h2>
            <p>
              These terms may be updated. Material changes will be highlighted on the platform.
              Continued use after updates constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Contact</h2>
            <p>
              Questions about these terms? Contact information will be added soon. For now,
              support inquiries can be submitted through the platform interface.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
