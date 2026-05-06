import "server-only";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * After a user is provisioned with an embeddedWalletAddress, call this to
 * add their address to the Helius webhook's monitored set.
 *
 * If this fails, the cron poller still catches the deposit — webhook is the
 * fast path, not the only path. So we log and continue, never throw upstream.
 */
export async function registerWalletWithHelius(address: string): Promise<void> {
  const env = getEnv();
  if (!env.HELIUS_WEBHOOK_ID || !env.HELIUS_RPC_URL) {
    logger.warn({ address }, "helius register skipped: HELIUS_WEBHOOK_ID/HELIUS_RPC_URL not set (poller will catch)");
    return;
  }
  const url = `https://api.helius.xyz/v0/webhooks/${env.HELIUS_WEBHOOK_ID}?api-key=${getApiKeyFromRpcUrl(env.HELIUS_RPC_URL)}`;
  try {
    // GET current list, append, PUT back
    const current = await fetch(url).then((r) => r.json());
    const addresses: string[] = Array.isArray(current.accountAddresses) ? current.accountAddresses : [];
    if (addresses.includes(address)) return;
    addresses.push(address);
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...current, accountAddresses: addresses }),
    });
    logger.info({ address }, "registered wallet with helius webhook");
  } catch (err) {
    logger.warn({ address, err: (err as Error).message }, "helius register failed (poller will catch)");
  }
}

function getApiKeyFromRpcUrl(rpcUrl: string): string {
  const u = new URL(rpcUrl);
  return u.searchParams.get("api-key") ?? "";
}
