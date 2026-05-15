"use client";

import { useState, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: (failureCount, error) => {
              const status = (error as { httpStatus?: number } | null)?.httpStatus;
              if (typeof status === "number" && status >= 400 && status < 500) {
                return false;
              }
              return failureCount < 2;
            },
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
  );

  if (!PRIVY_APP_ID && process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_PRIVY_APP_ID is not set. Configure in .env.local or hosting env.",
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {!PRIVY_APP_ID ? (
        <>
          <DevModeAuthBanner />
          {children}
        </>
      ) : (
        <PrivyProvider
          appId={PRIVY_APP_ID}
          config={{
            loginMethods: ["email", "wallet"],
            embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
            appearance: { theme: "light", accentColor: "#0ea5e9" },
          }}
        >
          {children}
        </PrivyProvider>
      )}
      <Toaster />
    </QueryClientProvider>
  );
}

function DevModeAuthBanner() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: "8px 16px",
        background: "#fef3c7",
        color: "#78350f",
        fontSize: 12,
        fontFamily: "monospace",
        borderBottom: "1px solid #fbbf24",
      }}
      role="alert"
    >
      NEXT_PUBLIC_PRIVY_APP_ID is not set. Auth disabled. Add to .env.local to enable login.
    </div>
  );
}
