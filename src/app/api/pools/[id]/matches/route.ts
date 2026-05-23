import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { addMatchToPool } from "@/lib/matches/service";
import { serializeMatch } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AddMatchBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  eventTime: z.string().datetime().optional(),
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

  const parsed = AddMatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id: poolId } = await ctx.params;

  try {
    const result = await addMatchToPool({
      poolId,
      callerId: user.id,
      title: parsed.data.title,
      description: parsed.data.description,
      eventTime: parsed.data.eventTime
        ? new Date(parsed.data.eventTime)
        : undefined,
      idempotencyKey,
    });
    return NextResponse.json(
      { data: serializeMatch(result.match) },
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
