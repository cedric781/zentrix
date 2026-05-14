import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/auth";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import { BetError } from "@/lib/bets/errors";
import { resolveBet } from "@/lib/settlement/router";
import { SettlementError } from "@/lib/settlement/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  method: z.enum([
    "OFFICIAL_RESULT",
    "ORACLE_VALUE",
    "PLATFORM_PROOF",
    "THRESHOLD_METRIC",
  ]),
  proof: z.unknown(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const idempotencyKey = parseIdempotencyKey(req);
    const user = await requireCurrentUser();
    const { id: betId } = await params;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const bet = await prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) {
      throw new BetError("BET_NOT_FOUND", "Bet not found", 404);
    }
    if (bet.createdById !== user.id && bet.opponentUserId !== user.id) {
      throw new BetError(
        "BET_NOT_PARTICIPANT",
        "Only participants can resolve",
        403,
      );
    }

    // P22 router — returns DECISION only, geen DB write.
    const result = await resolveBet({
      betId,
      template: {
        slug: "stub",
        settlementMethod: parsed.data.method,
        allowedSources: [],
      },
      proof: parsed.data.proof,
      initiatorUserId: user.id,
    });

    return NextResponse.json(
      {
        decision: {
          winnerSide: result.winnerSide,
          resolvedAt: result.resolvedAt.toISOString(),
          evidence: result.evidence,
          method: result.method,
        },
        note: "Returns resolution decision only. Use /propose-result + /confirm-result to commit.",
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    // SettlementError handling is route-local (not in mapDomainError per P22 loose coupling).
    if (err instanceof SettlementError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
