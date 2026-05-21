"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCurrentUser } from "./use-current-user";

/**
 * Server-verified delegation status for the current user, shaped to match
 * what use-wallet-delegation expects from Wager's reference hook.
 *
 * Wraps useCurrentUser (react-query against /api/me) and pulls the Privy
 * user id straight from the SDK — we don't ship privy_id over /api/me to
 * keep the public surface lean. Forensic logging in the delegation hook
 * uses privyUserId only for diagnostics, so the SDK value is sufficient.
 */
export function useAuthDelegation() {
  const { ready, user: privyUser } = usePrivy();
  const { data, isLoading, error, refetch } = useCurrentUser();

  return {
    userId: data?.id ?? null,
    privyUserId: privyUser?.id ?? null,
    embeddedWalletAddress: data?.embeddedWalletAddress ?? null,
    walletDelegatedAt: data?.walletDelegatedAt ?? null,
    loading: isLoading || !ready,
    error: error instanceof Error ? error.message : null,
    refresh: async () => {
      await refetch();
    },
  };
}
