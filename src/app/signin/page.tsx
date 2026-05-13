"use client";

/**
 * Sign-in page — Privy login + post-login redirect.
 * - Validates ?next= as local path (prevents open-redirect / CWE-601).
 * - Watches authenticated state; redirects when ready.
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DEFAULT_REDIRECT = "/feed";

function safeRedirectTarget(next: string | null): string {
  if (!next) return DEFAULT_REDIRECT;
  if (!next.startsWith("/")) return DEFAULT_REDIRECT;
  if (next.startsWith("//")) return DEFAULT_REDIRECT;
  if (next.includes("://")) return DEFAULT_REDIRECT;
  return next;
}

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, login } = usePrivy();

  const redirectTo = safeRedirectTarget(searchParams.get("next"));

  useEffect(() => {
    if (ready && authenticated) {
      router.replace(redirectTo);
    }
  }, [ready, authenticated, router, redirectTo]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in to Zentrix</CardTitle>
          <CardDescription>
            Use email or your Solana wallet. A wallet is created automatically if you don&apos;t have one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => login()}
            disabled={!ready || authenticated}
            size="lg"
            className="w-full"
          >
            {!ready ? "Loading\u2026" : authenticated ? "Signing in\u2026" : "Continue"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
