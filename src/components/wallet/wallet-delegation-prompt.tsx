"use client";

import { Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWalletDelegation } from "@/hooks/use-wallet-delegation";

/**
 * Inline prompt to authorize Zentrix's server signer for the user's
 * embedded Solana wallet. Renders only when the user can act on it
 * (READY_TO_AUTHORIZE or AUTHORIZATION_FAILED) so it doesn't flash
 * during the brief LOADING window after sign-in.
 *
 * Surfaces NO_SIGNER_CONFIGURED loudly — that means the deployment is
 * misconfigured and silent failure would be worse than a visible error.
 */
export function WalletDelegationPrompt({
  onAuthorized,
}: {
  onAuthorized?: () => void;
}) {
  const { status, delegate, delegating, error } = useWalletDelegation();

  if (
    status !== "READY_TO_AUTHORIZE" &&
    status !== "AUTHORIZATION_FAILED" &&
    status !== "NO_SIGNER_CONFIGURED"
  ) {
    return null;
  }

  const isMisconfigured = status === "NO_SIGNER_CONFIGURED";

  async function handleAuthorize() {
    const r = await delegate();
    if (r.ok) onAuthorized?.();
  }

  return (
    <div className="rounded-lg border border-[#2563EB]/30 bg-[#2563EB]/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
        <p className="text-sm font-medium">Enable withdrawals</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Authorize Zentrix to sign withdrawals on your behalf. Your private keys
        stay safe with Privy &mdash; you can revoke anytime.
      </p>
      {error && (
        <p className="text-xs text-destructive break-words">{error}</p>
      )}
      {isMisconfigured ? (
        <p className="text-xs text-destructive">
          Wallet authorization is not configured on this deployment. Contact
          support.
        </p>
      ) : (
        <Button
          type="button"
          onClick={handleAuthorize}
          disabled={delegating}
          className="bg-[#2563EB] hover:bg-[#2563EB]/90 text-white w-full sm:w-auto"
          size="sm"
        >
          {delegating ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Authorizing&hellip;
            </>
          ) : (
            "Enable withdrawals"
          )}
        </Button>
      )}
    </div>
  );
}
