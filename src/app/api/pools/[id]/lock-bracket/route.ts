import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { lockBracket } from "@/lib/brackets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LockBracketBody = z.object({
  format: z.enum(["SINGLE_ELIM", "DOUBLE_ELIM"]),
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

  const parsed = LockBracketBody.safeParse(
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
    const result = await lockBracket({
      poolId,
      callerId: user.id,
      format: parsed.data.format,
      idempotencyKey,
    });
    return NextResponse.json(
      {
        data: {
          matchCount: result.matchCount,
          bracketLockedAt: result.bracketLockedAt.toISOString(),
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
