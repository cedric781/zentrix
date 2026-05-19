import "server-only";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  HeliusEventArraySchema,
  type HeliusEvent,
  getApiKeyFromRpcUrl,
} from "./helius-types";

/**
 * Fetch enhanced transaction details for a batch of signatures.
 *
 * Returns same HeliusEvent shape as webhook input — guarantees
 * IDENTICAL tokenTransfers iteration between webhook and poller paths.
 * This is critical for deposit idempotency (txSignature, logIndex).
 *
 * Helius enhanced API: POST https://api.helius.xyz/v0/transactions
 * Body: { transactions: [sig1, sig2, ...] }
 * Limit: 100 signatures per call.
 */
export async function fetchEnhancedTransactions(
  signatures: string[],
): Promise<HeliusEvent[]> {
  if (signatures.length === 0) return [];
  if (signatures.length > 100) {
    throw new Error(
      `fetchEnhancedTransactions: max 100 signatures per call, got ${signatures.length}`,
    );
  }

  const env = getEnv();
  if (!env.HELIUS_RPC_URL) {
    throw new Error("HELIUS_RPC_URL not set");
  }
  const apiKey = getApiKeyFromRpcUrl(env.HELIUS_RPC_URL);
  if (!apiKey) {
    throw new Error("HELIUS_RPC_URL missing api-key query param");
  }

  const url = `https://api.helius.xyz/v0/transactions?api-key=${apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactions: signatures }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.error({ err, count: signatures.length }, "helius-enhanced: fetch failed");
    throw new Error("Helius enhanced API fetch failed");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: text.slice(0, 500), count: signatures.length },
      "helius-enhanced: bad status",
    );
    throw new Error(`Helius enhanced API returned ${res.status}`);
  }

  const json = await res.json();
  const parsed = HeliusEventArraySchema.safeParse(json);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues.slice(0, 5) },
      "helius-enhanced: schema mismatch",
    );
    throw new Error("Helius enhanced API returned unexpected shape");
  }

  return parsed.data;
}
