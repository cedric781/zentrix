import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { removeParticipant } from "@/lib/brackets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/pools/[id]/participants/[participantId]
 *
 * URL is nested for REST clarity. The pool [id] segment is descriptive only —
 * the service resolves a participant's pool via the participant row, so a
 * mismatched poolId in the URL has no effect (404 if participantId is bogus).
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; participantId: string }> },
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

  const { participantId } = await ctx.params;

  try {
    const result = await removeParticipant({
      participantId,
      callerId: user.id,
      idempotencyKey,
    });
    return NextResponse.json(
      { data: { removedId: result.removedId, freedSeed: result.freedSeed } },
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
