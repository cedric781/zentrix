import "server-only";
import { Connection } from "@solana/web3.js";
import { getEnv } from "@/lib/env";

let cached: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (cached) return cached;
  const env = getEnv();
  if (!env.HELIUS_RPC_URL) {
    throw new Error("HELIUS_RPC_URL must be set in environment");
  }
  cached = new Connection(env.HELIUS_RPC_URL, { commitment: "finalized" });
  return cached;
}

export function _resetSolanaConnection() {
  cached = null;
}
