import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { openDispute } from "@/lib/disputes/service";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import { serializeDispute } from "@/lib/http/serialize";
import { bigToStr } from "@/lib/http/bigint";

export const runtime = "nodejs";

const Body = z.object({
  reason: z.string().min(10).max(1000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: betId } = await params;

  let idempotencyKey: string;
  try {
    idempotencyKey = parseIdempotencyKey(req);
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }

  let user;
  try {
    user = await requireCurrentUser();
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await openDispute({
      betId,
      openerId: user.id,
      reason: parsed.data.reason,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        dispute: serializeDispute(result.dispute),
        depositUnits: bigToStr(result.depositUnits),
        ledgerTxId: result.ledgerTxId,
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
