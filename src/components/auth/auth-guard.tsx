"use client";

/**
 * AuthGuard — wraps client components that require authentication.
 *
 * IMPORTANT: Client-side guard is UX only (no flicker, smooth redirect).
 * Server-side authorization MUST be enforced in API route handlers via
 * Privy token verification.
 */

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Skeleton } from "@/components/ui/skeleton";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated } = usePrivy();

  useEffect(() => {
    if (ready && !authenticated) {
      const next = encodeURIComponent(pathname);
      router.replace(`/signin?next=${next}`);
    }
  }, [ready, authenticated, router, pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col gap-4 p-8">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return <>{children}</>;
}
