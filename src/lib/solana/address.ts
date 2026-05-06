import { PublicKey } from "@solana/web3.js";

export class InvalidSolanaAddressError extends Error {
  constructor(public input: string, public reason: string) {
    super(`Invalid Solana address: ${reason}`);
    this.name = "InvalidSolanaAddressError";
  }
}

/**
 * Parse a Solana address with the SAME constructor the SPL transfer code will
 * use. Throwing here means the address can NEVER reach the executor.
 *
 * Reference: LESSONS_FROM_WAGER.md R7 (validate at intake with the same call).
 * The Wager post-mortem ("Non-base58 character") is exactly the failure mode
 * this prevents.
 */
export function parseSolanaAddress(input: unknown): PublicKey {
  if (typeof input !== "string") {
    throw new InvalidSolanaAddressError(String(input), "not a string");
  }
  const trimmed = input.trim();
  if (trimmed.length < 32 || trimmed.length > 44) {
    throw new InvalidSolanaAddressError(trimmed, "length out of range");
  }
  try {
    return new PublicKey(trimmed);
  } catch (err) {
    throw new InvalidSolanaAddressError(trimmed, (err as Error).message);
  }
}
