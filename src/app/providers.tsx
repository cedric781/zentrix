"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { type ReactNode } from "react";
import { AuthSync } from "@/components/AuthSync";

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    throw new Error("NEXT_PUBLIC_PRIVY_APP_ID missing — see .env.example");
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google"],
        embeddedWallets: {
          solana: { createOnLogin: "all-users" },
        },
        appearance: { theme: "dark", accentColor: "#FF6A00" },
      }}
    >
      <AuthSync />
      {children}
    </PrivyProvider>
  );
}