import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Zentrix</h1>
        <p className="mt-4 text-lg text-muted-foreground sm:text-xl">
          Peer-to-peer wagering on Solana. Settle in USDC, with reputation that follows you.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link href="/signin">Get started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/feed">Browse bets</Link>
          </Button>
        </div>
        <p className="mt-12 text-sm text-muted-foreground">
          USDC settlement &middot; Solana wallets &middot; Dispute resolution
        </p>
      </div>
    </main>
  );
}
