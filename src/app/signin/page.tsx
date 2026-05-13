"use client";

/**
 * Sign-in page — Privy login + post-login redirect.
 * - Validates ?next= as local path (prevents open-redirect / CWE-601).
 * - useSearchParams requires Suspense boundary for static prerender.
 */

import { Suspense, useEffect } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";

const DEFAULT_REDIRECT = "/feed";

function safeRedirectTarget(next: string | null): string {
  if (!next) return DEFAULT_REDIRECT;
  if (!next.startsWith("/")) return DEFAULT_REDIRECT;
  if (next.startsWith("//")) return DEFAULT_REDIRECT;
  if (next.includes("://")) return DEFAULT_REDIRECT;
  return next;
}

function SignInContent() {
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
          {!ready ? "Loading…" : authenticated ? "Signing in…" : "Continue"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SignInFallback() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-full" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-11 w-full" />
      </CardContent>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Suspense fallback={<SignInFallback />}>
        <SignInContent />
      </Suspense>
    </main>
  );
}
