import { NextResponse } from "next/server";
import { z } from "zod";
import { BetStatus } from "@prisma/client";
import { requireCurrentUser } from "@/lib/auth";
import { createBet } from "@/lib/bets/service";
import { listBets } from "@/lib/bets/read";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { parseListQuery } from "@/lib/http/query";
import { mapDomainError } from "@/lib/http/errors";
import { serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BetStatusEnum = z.enum(
  Object.values(BetStatus) as [string, ...string[]],
);

const Body = z.object({
  side: z.enum(["A", "B"]),
  stakeUnits: z.string().regex(/^\d+$/, "stakeUnits must be a decimal string"),
  expiresInHours: z.number().int().min(1).max(168),
  poolId: z.string().min(1).optional(),
  matchId: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  outcomeA: z.string().min(1).max(100),
  outcomeB: z.string().min(1).max(100),
  externalRef: z
    .object({
      provider: z.enum(["espn", "thesportsdb"]),
      eventId: z.string().min(1).max(200),
      league: z.string().min(1).max(100),
      sport: z.enum([
        "football",
        "basketball",
        "american_football",
        "ice_hockey",
        "baseball",
        "tennis",
        "mma",
      ]),
      eventStartsAt: z.string().datetime(),
      eventEndsAt: z.string().datetime(),
    })
    .optional(),
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
      title: parsed.data.title,
      outcomeA: parsed.data.outcomeA,
      outcomeB: parsed.data.outcomeB,
      idempotencyKey,
      externalRef: parsed.data.externalRef
        ? {
            ...parsed.data.externalRef,
            eventStartsAt: new Date(parsed.data.externalRef.eventStartsAt),
            eventEndsAt: new Date(parsed.data.externalRef.eventEndsAt),
          }
        : undefined,
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

export async function GET(req: Request) {
  try {
    const user = await requireCurrentUser();
    const parsed = parseListQuery(req, BetStatusEnum);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { status, cursor, take } = parsed.data;
    const result = await listBets({
      userId: user.id,
      status: status as BetStatus | undefined,
      cursor,
      take,
    });
    return NextResponse.json({
      items: result.items.map(serializeBet),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
