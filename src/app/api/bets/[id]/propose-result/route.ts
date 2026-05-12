import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { proposeResult } from "@/lib/bets/service";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import {
  serializeBet,
  serializeBetResultClaim,
} from "@/lib/http/serialize";

export const runtime = "nodejs";

const Body = z.object({
  claimedWinnerId: z.string().min(1),
  note: z.string().max(500).optional(),
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
    const result = await proposeResult({
      betId,
      callerId: user.id,
      claimedWinnerId: parsed.data.claimedWinnerId,
      note: parsed.data.note,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        bet: serializeBet(result.bet),
        claim: serializeBetResultClaim(result.claim),
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
