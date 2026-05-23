import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { PUBLIC_STATUSES, getPool } from "@/lib/pools/read";
import { serializeMatch, serializePool } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await ctx.params;
    const pool = await getPool({ id });
    if (!pool) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const isOwner = pool.createdById === user.id;
    const isPublicReadable = PUBLIC_STATUSES.includes(pool.status);
    if (!isOwner && !isPublicReadable) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      data: {
        ...serializePool(pool),
        matches: pool.matches.map(serializeMatch),
      },
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
