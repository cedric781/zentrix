import { NextResponse } from "next/server";
import { z } from "zod";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { parseSolanaAddress, InvalidSolanaAddressError } from "@/lib/solana/address";
import { transferUsdcOnChain } from "@/lib/solana/transfer";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USDC_DECIMALS = 6;

const Body = z.object({
  destination: z.string().min(32).max(44),
  // DEFAULT-SAFE: omitted/undefined → dryRun. Only an explicit false sends.
  dryRun: z.boolean().optional(),
});

/**
 * One-off guarded admin route to sweep the escrow wallet's full USDC balance to
 * a destination wallet. Built behind a simulate→GO gate.
 *
 * Fail-closed guards (all required):
 *   1. Bearer ADMIN_API_TOKEN via requireAdmin().
 *   2. ESCROW_RELEASE_ENABLED === "true" (default-off operator switch).
 *   3. Valid Solana destination pubkey.
 *
 * Double-send guard: the LIVE on-chain escrow balance is the source of truth.
 * amount = BigInt(live balance), so a re-run after a successful sweep reads 0
 * and returns { status: "already-empty" } — a no-op.
 *
 * Writes ZERO DB/ledger rows. Ledger bookkeeping is PHASE 2.
 */
export async function POST(req: Request) {
  // ── Guard 1: admin auth ───────────────────────────────────────────────
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return new Response("unauthorized", { status: 401 });
    }
    throw e;
  }

  // ── Guard 2: operator kill switch (default-off) ───────────────────────
  if (process.env.ESCROW_RELEASE_ENABLED !== "true") {
    return NextResponse.json(
      { error: "disabled", detail: "ESCROW_RELEASE_ENABLED is not 'true'" },
      { status: 403 },
    );
  }

  // ── Body + Guard 3: destination validity ──────────────────────────────
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { destination, dryRun = true } = parsed.data;

  let destPubkey: PublicKey;
  try {
    destPubkey = parseSolanaAddress(destination);
  } catch (e) {
    if (e instanceof InvalidSolanaAddressError) {
      return NextResponse.json(
        { error: "invalid_destination", detail: e.message },
        { status: 400 },
      );
    }
    throw e;
  }

  // ── Public config read DIRECTLY from process.env (no getEnv / no Privy)
  // so the dryRun path works even where signing secrets are absent. ───────
  const escrowAddress = process.env.ESCROW_WALLET_ADDRESS;
  const usdcMintAddress = process.env.USDC_MINT_ADDRESS;
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!escrowAddress || !usdcMintAddress || !rpcUrl) {
    return NextResponse.json(
      {
        error: "misconfigured",
        detail: "ESCROW_WALLET_ADDRESS, USDC_MINT_ADDRESS, HELIUS_RPC_URL must be set",
      },
      { status: 500 },
    );
  }

  const escrowPubkey = parseSolanaAddress(escrowAddress);
  const usdcMint = parseSolanaAddress(usdcMintAddress);
  const connection = new Connection(rpcUrl, { commitment: "finalized" });

  const escrowAta = getAssociatedTokenAddressSync(usdcMint, escrowPubkey, true);
  const destinationAta = getAssociatedTokenAddressSync(usdcMint, destPubkey, true);

  // ── LIVE balance (primary double-send guard) ──────────────────────────
  let liveUnits: bigint;
  try {
    const bal = await connection.getTokenAccountBalance(escrowAta, "finalized");
    liveUnits = BigInt(bal.value.amount);
  } catch (e) {
    // ATA missing → effectively empty.
    logger.warn(
      { escrowAta: escrowAta.toBase58(), err: e instanceof Error ? e.message : String(e) },
      "escrow-release: live balance read failed (treating as empty)",
    );
    liveUnits = 0n;
  }

  if (liveUnits === 0n) {
    logger.info(
      { actor: "admin", destination, amount: "0", dryRun, sig: null },
      "escrow-release: already-empty (no-op)",
    );
    return NextResponse.json({ status: "already-empty" });
  }

  const amount = liveUnits; // BigInt — guarantees true 0 after sweep.

  // ── DRY RUN (default): build tx + simulate, NEVER load Privy / send ────
  if (dryRun) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("finalized");
    const tx = new Transaction({
      feePayer: escrowPubkey,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(
      createTransferCheckedInstruction(
        escrowAta,
        usdcMint,
        destinationAta,
        escrowPubkey,
        amount,
        USDC_DECIMALS,
      ),
    );
    // No signers → sigVerify:false; we only want the program-execution result.
    const sim = await connection.simulateTransaction(tx);

    logger.info(
      { actor: "admin", destination, amount: amount.toString(), dryRun: true, sig: null },
      "escrow-release: dryRun simulation",
    );
    return NextResponse.json({
      amount: amount.toString(),
      escrowAta: escrowAta.toBase58(),
      destinationAta: destinationAta.toBase58(),
      willCreateAta: false,
      simulation: { err: sim.value.err, logs: sim.value.logs },
    });
  }

  // ── REAL SEND (dryRun:false) ──────────────────────────────────────────
  // Requires the signing secrets. ESCROW_WALLET_ID is Production-only, so a
  // real send must run against a production deployment.
  const escrowWalletId = process.env.ESCROW_WALLET_ID;
  if (!escrowWalletId) {
    return NextResponse.json(
      {
        error: "signing_unavailable",
        detail:
          "ESCROW_WALLET_ID not configured in this environment (Production-only) — run the real send against prod",
      },
      { status: 503 },
    );
  }

  // Re-read live balance immediately before sending (TOCTOU narrowing).
  let sendUnits: bigint;
  try {
    const bal = await connection.getTokenAccountBalance(escrowAta, "finalized");
    sendUnits = BigInt(bal.value.amount);
  } catch {
    sendUnits = 0n;
  }
  if (sendUnits === 0n) {
    return NextResponse.json({ status: "already-empty" });
  }

  let sig: string;
  try {
    const res = await transferUsdcOnChain({
      fromWalletAddress: escrowAddress,
      fromWalletId: escrowWalletId,
      toWalletAddress: destination,
      amountUnits: sendUnits,
      idempotencyKey: `escrow-release:${destination}:${sendUnits}`,
      contextLabel: "admin-escrow-release-sweep",
    });
    sig = res.txSignature;
  } catch (e) {
    logger.error(
      { actor: "admin", destination, amount: sendUnits.toString(), err: e instanceof Error ? e.message : String(e) },
      "escrow-release: send failed",
    );
    return NextResponse.json(
      { error: "send_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // ── Verify true-zero post-sweep ───────────────────────────────────────
  let escrowBalanceAfter = "unknown";
  let destinationBalanceAfter = "unknown";
  try {
    const after = await connection.getTokenAccountBalance(escrowAta, "finalized");
    escrowBalanceAfter = after.value.amount;
  } catch {
    escrowBalanceAfter = "0"; // ATA closed/empty
  }
  try {
    const destAfter = await connection.getTokenAccountBalance(destinationAta, "finalized");
    destinationBalanceAfter = destAfter.value.amount;
  } catch {
    /* leave as unknown */
  }

  if (escrowBalanceAfter !== "0") {
    logger.error(
      { actor: "admin", destination, sig, escrowBalanceAfter },
      "escrow-release: POST-SWEEP escrow balance is NOT zero — investigate",
    );
  }

  logger.info(
    { actor: "admin", destination, amount: sendUnits.toString(), dryRun: false, sig },
    "escrow-release: send confirmed",
  );

  return NextResponse.json({
    sig,
    escrowBalanceAfter,
    destinationBalanceAfter,
  });
}
