import { z } from "zod";

/**
 * Helius enhanced transaction shape.
 *
 * Used by BOTH paths:
 * - Webhook handler (Helius pushes events)
 * - Poller (calls Helius enhanced API /v0/transactions)
 *
 * Both paths MUST parse identically so logIndex calculation is deterministic.
 * logIndex = position in tokenTransfers array (skip-or-credit, increment-always).
 * Critical for deposit idempotency unique key (txSignature, logIndex).
 */

export const HeliusTokenTransferSchema = z.object({
  fromUserAccount: z.string().nullable(),
  toUserAccount: z.string().nullable(),
  tokenAmount: z.number(),
  rawTokenAmount: z
    .object({
      tokenAmount: z.string(),
      decimals: z.number(),
    })
    .optional(),
  mint: z.string(),
});

export const HeliusEventSchema = z.object({
  signature: z.string().min(40),
  slot: z.number().int().nonnegative(),
  type: z.string(),
  tokenTransfers: z.array(HeliusTokenTransferSchema).default([]),
});

export const HeliusEventArraySchema = z.array(HeliusEventSchema);

export type HeliusTokenTransfer = z.infer<typeof HeliusTokenTransferSchema>;
export type HeliusEvent = z.infer<typeof HeliusEventSchema>;

/**
 * Helius RPC URLs format:
 *   https://mainnet.helius-rpc.com/?api-key=XXX
 *
 * Returns "" if api-key query param missing (caller must handle).
 */
export function getApiKeyFromRpcUrl(rpcUrl: string): string {
  const u = new URL(rpcUrl);
  return u.searchParams.get("api-key") ?? "";
}
