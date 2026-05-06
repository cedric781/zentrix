"use client";
import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

export function AuthSync() {
  const { authenticated, getAccessToken, ready } = usePrivy();

  useEffect(() => {
    if (!ready) return;
    (async () => {
      if (authenticated) {
        const token = await getAccessToken();
        if (token) {
          await fetch("/api/auth/sync-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: token }),
          });
        }
      } else {
        await fetch("/api/auth/sync-token", { method: "DELETE" });
      }
    })();
  }, [authenticated, ready, getAccessToken]);

  return null;
}