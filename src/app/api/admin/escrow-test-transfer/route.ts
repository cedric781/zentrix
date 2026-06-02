import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { transferUsdcOnChain, TransferUsdcError } from "@/lib/solana/transfer";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEST_UNITS = 1_000_000n; // 1 USDC

const Body = z.object({
  toAddress: z.string().min(32).max(44),
  amountUnits: z.string().regex(/^\d+$/, "amountUnits must be integer micro-USDC string"),
  // Optional Privy walletId for the escrow wallet. Falls back to
  // ESCROW_WALLET_ID env. When set, signing uses the walletId path.
  walletId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) return new Response("unauthorized", { status: 401 });
    throw e;
  }

  // Env-guard: dood (404) tenzij expliciet aangezet. Dubbele beveiliging.
  if (getEnv().ESCROW_TEST_ENABLED !== "true") {
    return new Response("not_found", { status: 404 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_body", issues: parsed.error.issues }, { status: 400 });
  }

  const amountUnits = BigInt(parsed.data.amountUnits);
  if (amountUnits <= 0n || amountUnits > MAX_TEST_UNITS) {
    return NextResponse.json(
      { error: "amount_out_of_range", max: MAX_TEST_UNITS.toString(), got: amountUnits.toString() },
      { status: 400 },
    );
  }

  const escrow = getEnv().ESCROW_WALLET_ADDRESS;
  const fromWalletId = parsed.data.walletId ?? getEnv().ESCROW_WALLET_ID;
  try {
    const result = await transferUsdcOnChain({
      fromWalletAddress: escrow,
      fromWalletId,
      toWalletAddress: parsed.data.toAddress,
      amountUnits,
      contextLabel: "admin-escrow-signing-probe",
    });
    return NextResponse.json({
      ok: true, from: escrow, to: parsed.data.toAddress,
      signedVia: fromWalletId ? "walletId" : "address",
      amountUnits: amountUnits.toString(),
      txSignature: result.txSignature, slot: result.slot,
      createdDestinationAta: result.createdDestinationAta,
    });
  } catch (err) {
    if (err instanceof TransferUsdcError) {
      return NextResponse.json({
        ok: false, errorType: "TransferUsdcError", code: err.code,
        message: err.message,
        cause: err.cause instanceof Error ? err.cause.message : String(err.cause ?? ""),
      }, { status: 502 });
    }
    return NextResponse.json({
      ok: false, errorType: "Unknown",
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
