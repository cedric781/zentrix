import "server-only";
import type { BetStatus } from "@prisma/client";
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

    // Direct findUnique (bypasses lib/bets/read.getBet) so we can include
    // resultClaims[0] for settlement UI hydration. Visibility is enforced in
    // code via canViewBet rather than a WHERE participant-gate, so OPEN bets
    // are readable by invited prospects (public marketplace) while pre-OPEN
    // (DRAFT/PENDING_ESCROW) and post-OPEN states stay participant-restricted.
    const bet = await prisma.bet.findUnique({
      where: { id },
      include: {
        resultClaims: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!bet || !canViewBet(bet, user.id)) {
      // 404 (not 403) on deny: don't leak existence of bets the caller can't see.
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

/**
 * Read visibility for a single bet:
 *   - OPEN                  → public marketplace, any authenticated caller.
 *   - DRAFT / PENDING_ESCROW → creator-only (private until escrow confirmed).
 *   - all other states       → participants only (creator or opponent).
 *
 * Enumerating only the two restricted-but-creator-visible states keeps every
 * post-OPEN state (ACTIVE, RESULT_PROPOSED, AWAITING_CONFIRMATION, DISPUTED,
 * SETTLED, CANCELLED, EXPIRED, VOID) participant-gated by default — no enum
 * value can silently fall through to "visible to nobody".
 */
function canViewBet(
  bet: { status: BetStatus; createdById: string; opponentUserId: string | null },
  userId: string,
): boolean {
  if (bet.status === "OPEN") return true;
  if (bet.status === "DRAFT" || bet.status === "PENDING_ESCROW") {
    return bet.createdById === userId;
  }
  return bet.createdById === userId || bet.opponentUserId === userId;
}
