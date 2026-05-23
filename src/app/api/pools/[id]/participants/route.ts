import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { addParticipant } from "@/lib/brackets/service";
import { listParticipants } from "@/lib/brackets/read";
import { serializePoolParticipant } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AddParticipantBody = z.object({
  displayName: z.string().min(1).max(100),
  seed: z.number().int().min(1).max(64).optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await ctx.params;
    const participants = await listParticipants({
      poolId: id,
      userId: user.id,
    });
    return NextResponse.json({
      items: participants.map(serializePoolParticipant),
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}

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

  const parsed = AddParticipantBody.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id: poolId } = await ctx.params;

  try {
    const result = await addParticipant({
      poolId,
      callerId: user.id,
      displayName: parsed.data.displayName,
      seed: parsed.data.seed,
      idempotencyKey,
    });
    return NextResponse.json(
      { data: serializePoolParticipant(result.participant) },
      {
        status: 201,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
