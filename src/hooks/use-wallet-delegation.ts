"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePrivy, useWallets, useSigners } from "@privy-io/react-auth";
import { useAuthDelegation } from "./use-auth-delegation";

/**
 * Canonical wallet-authorization state machine — one source of truth for
 * every UI surface that needs to know whether the embedded Solana wallet
 * has authorized our server signer.
 *
 * ── TEE-correct path ─────────────────────────────────────────────────────
 * Zentrix embedded wallets run under Privy TEE execution, not on-device.
 * `useDelegatedActions().delegateWallet(...)` is documented as on-device
 * only; calling it against a TEE wallet neither errors nor resolves, so
 * the UI spins forever. TEE wallets grant server-side authority via
 * session signers instead.
 *
 * We use `useSigners().addSigners({ address, signers: [{ signerId }] })`
 * (successor to the deprecated `useSessionSigners`). The `signerId` is the
 * app's authorization key configured in the Privy dashboard, exposed to
 * the client via `NEXT_PUBLIC_PRIVY_SIGNER_ID` (safe — identifier only).
 *
 * Reference: Wager (working TEE delegation flow).
 */

export type DelegationStatus =
  | "LOADING"
  | "NO_EMBEDDED_WALLET"
  | "NO_SIGNER_CONFIGURED"
  | "READY_TO_AUTHORIZE"
  | "AUTHORIZING"
  | "AUTHORIZED"
  | "AUTHORIZATION_FAILED";

export interface WalletDelegation {
  status: DelegationStatus;
  delegate: () => Promise<{ ok: true } | { ok: false; error: string }>;
  delegating: boolean;
  error: string | null;
}

const AUTHORIZE_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_PRIVY_AUTHORIZE_TIMEOUT_MS ?? 30_000,
);

const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

// Stable prefix [WITHDRAW_AUTH_FORENSIC] so every authorize-flow event can
// be grepped from the browser console with one filter. Mirrors to server
// via fire-and-forget POST to /api/admin/auth-forensic-log.
function authForensic(event: string, detail: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    tag: "WITHDRAW_AUTH_FORENSIC",
    event,
    ...detail,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
  if (typeof window !== "undefined") {
    try {
      void fetch("/api/admin/auth-forensic-log", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* swallow — diagnostic only */
    }
  }
}

export function useWalletDelegation(): WalletDelegation {
  const { ready: privyReady, authenticated, user: privyUser } = usePrivy();
  const { wallets } = useWallets();
  const { addSigners } = useSigners();
  const {
    userId: authUserId,
    privyUserId: authPrivyUserId,
    embeddedWalletAddress: authWallet,
    walletDelegatedAt: serverDelegatedAt,
    loading: authLoading,
    refresh: refreshAuth,
  } = useAuthDelegation();

  const [delegating, setDelegating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const inFlightRef = useRef<
    null | Promise<{ ok: true } | { ok: false; error: string }>
  >(null);

  // Server `walletDelegatedAt` is authoritative. Privy's `delegated` flag is
  // a lagging mirror — bridge during the brief window between addSigners()
  // resolving and /api/me reflecting the DB after refresh.
  const privyWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = authWallet ?? privyWallet?.address ?? null;
  const privyDelegated = !!(privyWallet as unknown as { delegated?: boolean })
    ?.delegated;
  const isAuthorized = !!serverDelegatedAt || privyDelegated;

  let status: DelegationStatus;
  if (authLoading || !privyReady) status = "LOADING";
  else if (delegating) status = "AUTHORIZING";
  else if (!walletAddress) status = "NO_EMBEDDED_WALLET";
  else if (isAuthorized) status = "AUTHORIZED";
  else if (!PRIVY_SIGNER_ID) status = "NO_SIGNER_CONFIGURED";
  else if (error) status = "AUTHORIZATION_FAILED";
  else status = "READY_TO_AUTHORIZE";

  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.debug("[WITHDRAW_AUTH_UI]", {
      status,
      walletAddress: walletAddress?.slice(0, 6) ?? null,
      serverDelegatedAt,
      privyDelegated,
      privyReady,
      authenticated,
      authLoading,
      hasSignerId: !!PRIVY_SIGNER_ID,
    });
  }

  const delegate = useCallback(async (): Promise<
    { ok: true } | { ok: false; error: string }
  > => {
    // Snapshot identity/wallet sources up front so every forensic log line
    // in this invocation refers to the same coherent set of values even if
    // Privy + AuthContext re-render mid-flight.
    const privyWalletSnapshot = wallets.find(
      (w) => w.walletClientType === "privy",
    );
    const snap = {
      user_id: authUserId,
      privy_user_id: authPrivyUserId ?? privyUser?.id ?? null,
      auth_embedded: authWallet,
      privy_client_embedded: privyWalletSnapshot?.address ?? null,
      resolved_wallet: walletAddress,
      destination_type: "embedded" as const,
      auth_vs_privy_match:
        authWallet !== null && privyWalletSnapshot?.address !== undefined
          ? authWallet === privyWalletSnapshot.address
          : null,
      delegation_status_before: status,
      server_delegated_at: serverDelegatedAt,
      privy_delegated_mirror: privyDelegated,
    };

    if (isAuthorized) {
      authForensic("delegate_short_circuit_already_authorized", snap);
      return { ok: true };
    }
    if (!walletAddress) {
      const msg = "Wallet still initializing — wait a moment and retry.";
      if (mountedRef.current) setError(msg);
      authForensic("delegate_preflight_no_wallet", { ...snap, msg });
      return { ok: false, error: msg };
    }
    if (!PRIVY_SIGNER_ID) {
      const msg =
        "Wallet authorization is not configured on this deployment (NEXT_PUBLIC_PRIVY_SIGNER_ID missing). Contact support.";
      if (mountedRef.current) setError(msg);
      authForensic("delegate_preflight_no_signer_id", { ...snap, msg });
      return { ok: false, error: msg };
    }
    if (inFlightRef.current) {
      authForensic("delegate_short_circuit_in_flight", snap);
      return inFlightRef.current;
    }

    const run = async (): Promise<
      { ok: true } | { ok: false; error: string }
    > => {
      if (mountedRef.current) {
        setDelegating(true);
        setError(null);
      }
      authForensic("delegate_run_start", {
        ...snap,
        timeout_ms: AUTHORIZE_TIMEOUT_MS,
      });

      try {
        const addSignersStartedAt = Date.now();
        authForensic("addsigners_called", {
          ...snap,
          signer_id_present: !!PRIVY_SIGNER_ID,
        });
        const authorize = addSigners({
          address: walletAddress,
          signers: [{ signerId: PRIVY_SIGNER_ID }],
        });
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Authorization timed out after ${Math.round(
                    AUTHORIZE_TIMEOUT_MS / 1000,
                  )}s. Try again.`,
                ),
              ),
            AUTHORIZE_TIMEOUT_MS,
          );
        });

        try {
          await Promise.race([authorize, timeout]);
        } catch (addErr) {
          // Privy rejects with "Duplicate signer(s) provided" when the
          // signerId is already registered — that is the exact success-
          // equivalent state we want. Fall through to the persist +
          // refreshAuth path so the UI catches up with on-chain reality.
          const errMsg =
            addErr instanceof Error ? addErr.message : String(addErr);
          const isDuplicateSigner = /duplicate\s*signer/i.test(errMsg);
          if (isDuplicateSigner) {
            authForensic("addsigners_duplicate_signer_treated_as_success", {
              ...snap,
              elapsed_ms: Date.now() - addSignersStartedAt,
              error_message: errMsg.slice(0, 200),
            });
          } else {
            authForensic("addsigners_failed_or_timeout", {
              ...snap,
              elapsed_ms: Date.now() - addSignersStartedAt,
              error_name:
                addErr instanceof Error ? addErr.name : typeof addErr,
              error_message: errMsg.slice(0, 200),
            });
            throw addErr;
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
        authForensic("addsigners_resolved", {
          ...snap,
          elapsed_ms: Date.now() - addSignersStartedAt,
        });

        // Half the addSigners budget for the persist fetch — worst case
        // end-to-end stays under AUTHORIZE_TIMEOUT_MS. Without this, a
        // mobile-network stall after Privy succeeded leaves the button
        // stuck on "Authorizing..." indefinitely.
        const persistController = new AbortController();
        const persistTimer = setTimeout(
          () => persistController.abort(),
          Math.max(5_000, Math.floor(AUTHORIZE_TIMEOUT_MS / 2)),
        );
        const persistStartedAt = Date.now();
        authForensic("persist_fetch_called", {
          ...snap,
          budget_ms: Math.max(5_000, Math.floor(AUTHORIZE_TIMEOUT_MS / 2)),
        });
        let res: Response;
        try {
          res = await fetch("/api/wallet/delegation-status", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delegated: true }),
            signal: persistController.signal,
          });
        } catch (fetchErr) {
          const isAbort =
            fetchErr instanceof Error &&
            (fetchErr.name === "AbortError" ||
              /aborted|timeout/i.test(fetchErr.message));
          authForensic("persist_fetch_failed_or_timeout", {
            ...snap,
            elapsed_ms: Date.now() - persistStartedAt,
            is_abort: isAbort,
            error_name:
              fetchErr instanceof Error ? fetchErr.name : typeof fetchErr,
            error_message:
              fetchErr instanceof Error
                ? fetchErr.message.slice(0, 200)
                : String(fetchErr).slice(0, 200),
          });
          throw new Error(
            isAbort
              ? `Server didn't respond within ${Math.floor(
                  AUTHORIZE_TIMEOUT_MS / 2 / 1000,
                )}s. Network slow — try again.`
              : `Server persistence request failed: ${
                  fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
                }`,
          );
        } finally {
          clearTimeout(persistTimer);
        }
        const persistRequestId = res.headers.get("X-Request-Id");
        let bodyJson: {
          success?: boolean;
          error?: {
            code?: string;
            message?: string;
            details?: { cause?: string };
          };
        } = {};
        try {
          bodyJson = await res.json();
        } catch {
          /* tolerate empty body */
        }
        authForensic("persist_fetch_resolved", {
          ...snap,
          elapsed_ms: Date.now() - persistStartedAt,
          status: res.status,
          request_id: persistRequestId,
          body_success: bodyJson.success ?? null,
          body_code: bodyJson.error?.code ?? null,
        });
        if (!res.ok || bodyJson.success === false) {
          const code = bodyJson.error?.code ?? `HTTP_${res.status}`;
          const detail =
            bodyJson.error?.message ??
            `Server persistence failed (HTTP ${res.status}).`;
          const cause = bodyJson.error?.details?.cause;
          const reqIdSfx = persistRequestId ? ` (req ${persistRequestId})` : "";
          throw new Error(
            `${detail} [${code}${cause ? ` — ${cause.slice(0, 200)}` : ""}]${reqIdSfx}`,
          );
        }

        await refreshAuth();
        authForensic("delegate_success", {
          ...snap,
          request_id: persistRequestId,
        });
        return { ok: true };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Authorization failed";
        if (mountedRef.current) setError(msg);
        authForensic("delegate_failed", {
          ...snap,
          error_message: msg.slice(0, 200),
          error_name: err instanceof Error ? err.name : typeof err,
        });
        return { ok: false, error: msg };
      } finally {
        if (mountedRef.current) setDelegating(false);
        authForensic("delegate_loading_cleared", {
          ...snap,
          mounted: mountedRef.current,
        });
      }
    };

    const p = run().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = p;
    return p;
  }, [
    wallets,
    authUserId,
    authPrivyUserId,
    privyUser?.id,
    authWallet,
    walletAddress,
    status,
    serverDelegatedAt,
    privyDelegated,
    isAuthorized,
    addSigners,
    refreshAuth,
  ]);

  return { status, delegate, delegating, error };
}
