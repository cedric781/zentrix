"use client";

import { useWalletDelegation } from "@/hooks/use-wallet-delegation";

export interface WalletDelegationStatusCardProps {
  /** Server-side timestamp from User.walletDelegatedAt (ISO string).
   *  Optional — when present, shown next to AUTHORIZED state. */
  initialDelegatedAt?: string | null;
}

export function WalletDelegationStatusCard({
  initialDelegatedAt,
}: WalletDelegationStatusCardProps) {
  const { status, delegate, delegating, error } = useWalletDelegation();

  const handleDelegate = () => {
    delegate().catch((e: unknown) => {
      console.error("[wallet-delegation] delegate failed", e);
    });
  };

  if (status === "LOADING") {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          <span>Checking wallet authorization…</span>
        </div>
      </div>
    );
  }

  if (status === "NO_EMBEDDED_WALLET") {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          <span>Provisioning wallet…</span>
        </div>
      </div>
    );
  }

  if (status === "NO_SIGNER_CONFIGURED") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-card p-4">
        <p className="text-sm font-medium text-red-500">Configuration error</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Wallet authorization is unavailable. Please contact support.
        </p>
      </div>
    );
  }

  if (status === "AUTHORIZED") {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-500/15 text-green-500"
            aria-hidden="true"
          >
            ✓
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Wallet authorized for betting</p>
            {initialDelegatedAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Authorized{" "}
                {new Date(initialDelegatedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isFailedState = status === "AUTHORIZATION_FAILED";
  const buttonLabel = delegating
    ? "Authorizing…"
    : isFailedState
      ? "Retry authorization"
      : "Authorize wallet";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Authorize wallet for betting</p>
          <p className="mt-1 text-xs text-muted-foreground">
            One-time approval needed before placing or accepting bets.
          </p>
        </div>
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={handleDelegate}
          disabled={delegating}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
