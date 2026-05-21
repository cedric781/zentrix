import "server-only";
import { PrivyClient } from "@privy-io/server-auth";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

let cached: PrivyClient | null = null;

export function getPrivyServerClient(): PrivyClient {
  if (cached) return cached;
  const env = getEnv();
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET must be set in environment");
  }

  // P61b: server-side wallet API signing for TEE wallets requires this key.
  // Privy adds the required `privy-authorization-signature` header when it's
  // configured. Without it, signAndSendTransaction fails with
  // "Missing `privy-authorization-signature` header or no signatures provided".
  // Non-withdrawal paths (getUserById, etc.) work without it, so we boot the
  // server either way and only warn when absent.
  const authorizationPrivateKey =
    env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim() || undefined;
  if (!authorizationPrivateKey) {
    logger.warn(
      "PRIVY_AUTHORIZATION_PRIVATE_KEY not set — wallet API signing disabled; withdrawals will fail",
    );
  }

  cached = authorizationPrivateKey
    ? new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET, {
        walletApi: { authorizationPrivateKey },
      })
    : new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
  return cached;
}

/** For tests only. */
export function _resetPrivyServerClient() {
  cached = null;
}
