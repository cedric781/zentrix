import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth";
import { createWithdrawal } from "@/lib/withdrawals/intake";
import { WithdrawalError } from "@/lib/withdrawals/errors";

export const runtime = "nodejs";

const Body = z.object({
  amountUsdc: z.string().min(1).max(40),
  toAddress: z.string().min(32).max(80),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }

  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_body", issues: body.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await createWithdrawal({
      userId: user.id,
      amountUsdc: body.data.amountUsdc,
      toAddress: body.data.toAddress,
    });
    return NextResponse.json({
      id: result.id,
      status: result.status,
      // BigInts not JSON-serializable — convert
      amountUsdc: result.amountUnits.toString(),
      feeUsdc: result.feeUnits.toString(),
      netUsdc: result.netUnits.toString(),
    });
  } catch (err) {
    if (err instanceof WithdrawalError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    throw err;
  }
}
