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
import { CreateBetBody } from "@/lib/bets/create-bet-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BetStatusEnum = z.enum(
  Object.values(BetStatus) as [string, ...string[]],
);

const ScopeEnum = z.enum(["mine", "all"]).default("mine");
const CategorySchema = z.string().min(1).max(50);

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

  const parsed = CreateBetBody.safeParse(await req.json().catch(() => ({})));
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
      templateId: parsed.data.templateId,
      category: parsed.data.category,
      isCustom: parsed.data.isCustom,
      settlementMode: parsed.data.settlementMode,
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

    const url = new URL(req.url);
    const scopeResult = ScopeEnum.safeParse(
      url.searchParams.get("scope") ?? undefined,
    );
    if (!scopeResult.success) {
      return NextResponse.json(
        { error: "bad_query", issues: scopeResult.error.issues },
        { status: 400 },
      );
    }
    const scope = scopeResult.data;

    const rawCategory = url.searchParams.get("category");
    let category: string | undefined;
    if (rawCategory !== null) {
      const categoryResult = CategorySchema.safeParse(rawCategory);
      if (!categoryResult.success) {
        return NextResponse.json(
          { error: "bad_query", issues: categoryResult.error.issues },
          { status: 400 },
        );
      }
      category = categoryResult.data;
    }

    const { status, cursor, take } = parsed.data;
    const result = await listBets({
      scope,
      userId: scope === "mine" ? user.id : undefined,
      status: status as BetStatus | undefined,
      category,
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
