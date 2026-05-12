import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { createBet } from "@/lib/bets/service";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import { serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";

const Body = z.object({
  side: z.enum(["A", "B"]),
  stakeUnits: z.string().regex(/^\d+$/, "stakeUnits must be a decimal string"),
  expiresInHours: z.number().int().min(1).max(168),
  poolId: z.string().min(1).optional(),
  matchId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
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
    const result = await createBet({
      creatorId: user.id,
      creatorSide: parsed.data.side,
      stakeUnits: BigInt(parsed.data.stakeUnits),
      expiresInHours: parsed.data.expiresInHours,
      poolId: parsed.data.poolId,
      matchId: parsed.data.matchId,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        bet: serializeBet(result.bet),
        inviteToken: result.inviteToken,
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
