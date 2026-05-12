import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { getPool } from "@/lib/pools/read";
import { serializeMatch } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await ctx.params;
    const pool = await getPool({ id, userId: user.id });
    if (!pool) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      data: {
        id: pool.id,
        createdById: pool.createdById,
        title: pool.title,
        description: pool.description,
        status: pool.status,
        bettingClosesAt: pool.bettingClosesAt.toISOString(),
        createdAt: pool.createdAt.toISOString(),
        updatedAt: pool.updatedAt.toISOString(),
        matches: pool.matches.map(serializeMatch),
      },
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
