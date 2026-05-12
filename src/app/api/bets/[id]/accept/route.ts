import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { acceptBet } from "@/lib/bets/service";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import { serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";

const Body = z.object({
  inviteToken: z.string().min(8).max(256),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;

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
    const result = await acceptBet({
      opponentUserId: user.id,
      inviteToken: parsed.data.inviteToken,
      idempotencyKey,
    });

    return NextResponse.json(
      { bet: serializeBet(result.bet) },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
