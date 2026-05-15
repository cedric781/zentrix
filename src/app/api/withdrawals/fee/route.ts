import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { calculateWithdrawalFee } from "@/lib/withdrawals/fee";
import { mapDomainError } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  amountUsdc: z
    .string()
    .regex(/^\d+$/, "amountUsdc must be decimal string in micro-units"),
});

export async function GET(req: Request) {
  try {
    await requireCurrentUser();
    const url = new URL(req.url);
    const parsed = Query.safeParse({
      amountUsdc: url.searchParams.get("amountUsdc") ?? "",
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const amount = BigInt(parsed.data.amountUsdc);
    const fee = calculateWithdrawalFee(amount);
    return NextResponse.json({
      amountUsdc: amount.toString(),
      feeUsdc: fee.toString(),
      netUsdc: (amount - fee).toString(),
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
