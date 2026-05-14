import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await ctx.params;

    // Direct findFirst (bypasses lib/bets/read.getBet) so we can include
    // resultClaims[0] for settlement UI hydration. Access guard (caller must
    // be participant) preserved via OR clause — same restriction as before.
    const bet = await prisma.bet.findFirst({
      where: {
        id,
        OR: [{ createdById: user.id }, { opponentUserId: user.id }],
      },
      include: {
        resultClaims: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!bet) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { resultClaims, ...rest } = bet;
    return NextResponse.json(
      serializeBet({ ...rest, latestClaim: resultClaims[0] ?? null }),
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
