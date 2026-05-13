"use client";

/**
 * Feed placeholder for B.2 — confirms auth flow end-to-end.
 * B.3 will replace this with the real bet list.
 */

import { usePrivy } from "@privy-io/react-auth";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function FeedPage() {
  return (
    <AuthGuard>
      <FeedContent />
    </AuthGuard>
  );
}

function FeedContent() {
  const { user, logout } = usePrivy();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Feed</h1>
        <Button onClick={() => logout()} variant="outline">
          Sign out
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>You&apos;re signed in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">User ID:</span> {user?.id ?? "\u2014"}
          </div>
          <div>
            <span className="font-medium text-foreground">Email:</span>{" "}
            {user?.email?.address ?? "(not provided)"}
          </div>
          <div>
            <span className="font-medium text-foreground">Wallet:</span>{" "}
            {user?.wallet?.address ?? "(no wallet)"}
          </div>
        </CardContent>
      </Card>

      <p className="mt-8 text-sm text-muted-foreground">
        Bet list coming in B.3.
      </p>
    </main>
  );
}
