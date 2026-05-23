import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { advanceWinnerToBracket } from "@/lib/brackets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AdvanceMatchBody = z.object({
  winnerParticipantId: z.string().uuid(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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

  const parsed = AdvanceMatchBody.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id: matchId } = await ctx.params;

  try {
    const result = await advanceWinnerToBracket({
      matchId,
      callerId: user.id,
      winnerParticipantId: parsed.data.winnerParticipantId,
      idempotencyKey,
    });
    return NextResponse.json(
      {
        data: {
          matchId: result.matchId,
          winnerParticipantId: result.winnerParticipantId,
          advancedToWinId: result.advancedToWinId,
          advancedToLossId: result.advancedToLossId,
        },
      },
      {
        status: 200,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
