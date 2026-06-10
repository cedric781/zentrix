import "server-only";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getSolanaConnection } from "./connection";
import { parseSolanaAddress } from "./address";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const LAMPORTS_PER_SOL = 1_000_000_000;

// SPL token account size in bytes — the rent-exemption basis for a fresh ATA.
const ATA_ACCOUNT_SIZE = 165;

// Fallback rent-exempt minimum for a 165-byte SPL token account, used ONLY when
// the RPC getMinimumBalanceForRentExemption call throws. This is the long-stable
// mainnet value; a warn is logged whenever the fallback is taken.
const ATA_RENT_EXEMPT_LAMPORTS_FALLBACK = 2_039_280;

// Per-ATA-create signature-fee headroom. Privy sponsors the fee in practice, but
// if sponsorship ever fails the escrow must still cover the 5_000-lamport base
// signature fee out of its own balance.
const SIG_BUFFER_LAMPORTS = 5_000;

function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

/**
 * Thrown when the escrow wallet's SOL balance cannot cover the rent + signature
 * headroom needed to create the destination ATA(s) for a payout. TRANSIENT by
 * nature — self-heals once the escrow wallet is topped up — so the caller must
 * route it through the RETRYABLE failure path, never terminal.
 */
export class EscrowSolInsufficientError extends Error {
  constructor(
    public readonly requiredLamports: number,
    public readonly balanceLamports: number,
    public readonly atasToCreate: number,
  ) {
    super(
      `Escrow SOL insufficient for ${atasToCreate} ATA create(s): ` +
        `required ${lamportsToSol(requiredLamports)} SOL, ` +
        `balance ${lamportsToSol(balanceLamports)} SOL`,
    );
    this.name = "EscrowSolInsufficientError";
  }
}

/**
 * Blocking SOL-balance preflight for the payout path. Purely a gate: derives the
 * USDC ATA for each destination owner, counts how many do NOT yet exist (and so
 * must be created — escrow pays their rent), and asserts the escrow wallet holds
 * enough SOL to cover that rent plus a signature buffer.
 *
 * Persists nothing. Does NOT send any on-chain transaction. Throws
 * EscrowSolInsufficientError when the balance is short; lets RPC errors
 * propagate (the caller treats both as retryable).
 *
 * ATA derivation MUST match transfer.ts exactly:
 *   getAssociatedTokenAddressSync(usdcMint, owner, true)  // allowOwnerOffCurve
 * so the address checked here is the address the transfer will create.
 */
export async function assertEscrowSolForAtas(params: {
  destinationOwners: string[];
}): Promise<{ requiredLamports: number; balanceLamports: number; atasToCreate: number }> {
  const conn = getSolanaConnection();
  const env = getEnv();
  const escrow = parseSolanaAddress(env.ESCROW_WALLET_ADDRESS);
  const usdcMint = parseSolanaAddress(env.USDC_MINT_ADDRESS);

  // Dedupe identical owners — the same wallet must not be counted twice.
  const uniqueOwners = [...new Set(params.destinationOwners)];

  let atasToCreate = 0;
  for (const owner of uniqueOwners) {
    const ownerPubkey = parseSolanaAddress(owner);
    const ata = getAssociatedTokenAddressSync(usdcMint, ownerPubkey, true);
    const info = await conn.getAccountInfo(ata, "confirmed");
    if (info === null) atasToCreate += 1;
  }

  if (atasToCreate === 0) {
    // All destination ATAs already exist — no rent needed, Privy sponsors the
    // bare transfer fee. Nothing to gate on.
    return { requiredLamports: 0, balanceLamports: 0, atasToCreate: 0 };
  }

  let rentPerAta: number;
  try {
    rentPerAta = await conn.getMinimumBalanceForRentExemption(ATA_ACCOUNT_SIZE);
  } catch (err) {
    rentPerAta = ATA_RENT_EXEMPT_LAMPORTS_FALLBACK;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), fallbackLamports: rentPerAta },
      "assertEscrowSolForAtas: getMinimumBalanceForRentExemption failed — using fallback rent constant",
    );
  }

  const requiredLamports = atasToCreate * (rentPerAta + SIG_BUFFER_LAMPORTS);
  const balanceLamports = await conn.getBalance(escrow, "finalized");

  if (balanceLamports < requiredLamports) {
    throw new EscrowSolInsufficientError(requiredLamports, balanceLamports, atasToCreate);
  }

  return { requiredLamports, balanceLamports, atasToCreate };
}
