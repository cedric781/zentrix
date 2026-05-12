import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { getUserReputation } from "@/lib/reputation/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const rep = await getUserReputation(user.id);
    return NextResponse.json({
      data: {
        userId: rep.userId,
        score: rep.score,
        tier: rep.tier,
        disputesOpened: rep.disputesOpened,
        disputesWon: rep.disputesWon,
        disputesLost: rep.disputesLost,
        lastUpdatedAt: rep.lastUpdatedAt.toISOString(),
      },
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
