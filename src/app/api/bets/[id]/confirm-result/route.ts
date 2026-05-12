import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { confirmResult } from "@/lib/bets/service";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import {
  serializeBet,
  serializeBetParticipantConfirmation,
} from "@/lib/http/serialize";

export const runtime = "nodejs";

const Body = z.object({
  decision: z.enum(["CONFIRM_WINNER", "DISAGREE"]),
  claimedWinnerId: z.string().min(1).optional(),
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
    const result = await confirmResult({
      betId,
      callerId: user.id,
      decision: parsed.data.decision,
      claimedWinnerId: parsed.data.claimedWinnerId,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        bet: serializeBet(result.bet),
        confirmation: serializeBetParticipantConfirmation(result.confirmation),
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
