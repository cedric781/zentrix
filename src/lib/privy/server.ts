import "server-only";
import { PrivyClient } from "@privy-io/server-auth";
import { getEnv } from "@/lib/env";

let cached: PrivyClient | null = null;

export function getPrivyServerClient(): PrivyClient {
  if (cached) return cached;
  const env = getEnv();
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET must be set in environment");
  }
  cached = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
  return cached;
}

/** For tests only. */
export function _resetPrivyServerClient() {
  cached = null;
}