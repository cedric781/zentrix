import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { getMatch } from "@/lib/matches/read";
import { serializeMatch, serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await ctx.params;
    const match = await getMatch({ id, userId: user.id });
    if (!match) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      data: {
        ...serializeMatch(match),
        pool: {
          id: match.pool.id,
          title: match.pool.title,
          status: match.pool.status,
        },
        bets: match.bets.map(serializeBet),
      },
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
