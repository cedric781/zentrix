import "server-only";
import {
  Transaction,
  type PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { getSolanaConnection } from "./connection";
import { parseSolanaAddress } from "./address";
import { getPrivyServerClient } from "@/lib/privy/server";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const USDC_DECIMALS = 6;

export interface TransferUsdcParams {
  fromWalletAddress: string;
  toWalletAddress: string;
  amountUnits: bigint;
  contextLabel?: string;
  /**
   * Optional Privy walletId for the source wallet. When set, signing
   * addresses the wallet directly via `{ walletId }` instead of the
   * (deprecated) `{ address, chainType }` path. Required for standalone
   * server wallets that have no associated Privy user — the address path
   * resolves through a user lookup and fails with "User not found with
   * provided wallet address". The address is still used for fee-payer and
   * ATA derivation; only the signer identifier changes.
   */
  fromWalletId?: string;
  /**
   * Optional Privy idempotency key. Aimed at the "chain succeeds, DB
   * sig-persist crashes, retry re-sends" window that caller-side sig-column
   * recovery cannot close (the crash happens before the sig is persisted).
   *
   * VERIFIED against @privy-io/server-auth@1.32.5 (dist/cjs):
   *   - The SDK forwards this verbatim as the HTTP header
   *     `privy-idempotency-key` (utils.js extractIdempotencyKeyHeader) and
   *     includes it in the authorization-signature payload.
   *   - All dedupe logic is SERVER-SIDE at Privy's backend; the SDK does NOT
   *     cache or special-case repeats. On a repeat it simply returns whatever
   *     the backend returns: success → { hash, caip2 }, or error → throws
   *     PrivyApiError(code, status, message).
   *
   * NOT VERIFIABLE from the installed package: what Privy's backend actually
   * does on a repeated key — return the original hash, throw a typed
   * duplicate error, or apply a TTL window. The SDK is pure transport and
   * carries no JSDoc on this. Treat repeat-behavior as UNDOCUMENTED here;
   * the payout processor (step 2) must defend against BOTH a returned hash
   * AND a duplicate-key error being the "already paid = success" signal.
   *
   * Use a stable per-leg key, e.g. `payout-winner:${betId}`. Applies to both
   * the walletId and address signing paths (top-level on the Privy RPC input).
   */
  idempotencyKey?: string;
}

export interface TransferUsdcResult {
  txSignature: string;
  slot: number;
  createdDestinationAta: boolean;
}

export class TransferUsdcError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ADDRESS"
      | "INVALID_AMOUNT"
      | "SELF_TRANSFER"
      | "PRIVY_SIGN_FAILED"
      | "CONFIRMATION_FAILED"
      | "TX_FAILED",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransferUsdcError";
  }
}

export async function transferUsdcOnChain(
  params: TransferUsdcParams,
): Promise<TransferUsdcResult> {
  const { fromWalletAddress, toWalletAddress, amountUnits, contextLabel, fromWalletId, idempotencyKey } = params;

  if (amountUnits <= 0n) {
    throw new TransferUsdcError(
      "INVALID_AMOUNT",
      `amountUnits must be > 0, got ${amountUnits}`,
    );
  }

  let fromPubkey: PublicKey;
  let toPubkey: PublicKey;
  try {
    fromPubkey = parseSolanaAddress(fromWalletAddress);
    toPubkey = parseSolanaAddress(toWalletAddress);
  } catch (err) {
    throw new TransferUsdcError(
      "INVALID_ADDRESS",
      `Invalid Solana address: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }

  if (fromPubkey.equals(toPubkey)) {
    throw new TransferUsdcError(
      "SELF_TRANSFER",
      "Cannot transfer USDC to same wallet",
    );
  }

  const env = getEnv();
  const usdcMint = parseSolanaAddress(env.USDC_MINT_ADDRESS);
  const connection = getSolanaConnection();

  const fromAta = getAssociatedTokenAddressSync(usdcMint, fromPubkey, true);
  const toAta = getAssociatedTokenAddressSync(usdcMint, toPubkey, true);

  let createdDestinationAta = false;
  const toAtaInfo = await connection.getAccountInfo(toAta, "confirmed");

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
  const tx = new Transaction({
    feePayer: fromPubkey,
    blockhash,
    lastValidBlockHeight,
  });

  if (toAtaInfo === null) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        fromPubkey,
        toAta,
        toPubkey,
        usdcMint,
      ),
    );
    createdDestinationAta = true;
  }

  tx.add(
    createTransferCheckedInstruction(
      fromAta,
      usdcMint,
      toAta,
      fromPubkey,
      amountUnits,
      USDC_DECIMALS,
    ),
  );

  const privy = getPrivyServerClient();
  let txSignature: string;
  try {
    // walletId path for user-less server wallets; address path (deprecated)
    // for user wallets — see TransferUsdcParams.fromWalletId.
    // idempotencyKey is a top-level field on the Privy RPC input
    // (WithOptionalIdempotencyKey wraps the walletId|address union), so it
    // is forwarded identically on both signing paths. Omitted when absent.
    const result = fromWalletId
      ? await privy.walletApi.solana.signAndSendTransaction({
          walletId: fromWalletId,
          transaction: tx,
          caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          sponsor: true,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        })
      : await privy.walletApi.solana.signAndSendTransaction({
          address: fromWalletAddress,
          chainType: "solana",
          transaction: tx,
          caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          sponsor: true,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
    txSignature = result.hash;
  } catch (err) {
    logger.error(
      {
        from: fromWalletAddress,
        to: toWalletAddress,
        amountUnits: amountUnits.toString(),
        contextLabel,
        err: err instanceof Error ? err.message : String(err),
      },
      "transferUsdcOnChain: privy sign failed",
    );
    throw new TransferUsdcError(
      "PRIVY_SIGN_FAILED",
      `Privy sign failed: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }

  let slot = 0;
  try {
    const confirmation = await connection.confirmTransaction(
      { signature: txSignature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (confirmation.value.err) {
      throw new TransferUsdcError(
        "TX_FAILED",
        `Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
      );
    }
    slot = confirmation.context.slot;
  } catch (err) {
    if (err instanceof TransferUsdcError) throw err;
    logger.error(
      { txSignature, contextLabel, err: err instanceof Error ? err.message : String(err) },
      "transferUsdcOnChain: confirmation failed",
    );
    throw new TransferUsdcError(
      "CONFIRMATION_FAILED",
      `Transaction confirmation timed out or failed: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }

  logger.info(
    {
      from: fromWalletAddress,
      to: toWalletAddress,
      amountUnits: amountUnits.toString(),
      txSignature,
      slot,
      createdDestinationAta,
      contextLabel,
    },
    "transferUsdcOnChain: success",
  );

  return { txSignature, slot, createdDestinationAta };
}
