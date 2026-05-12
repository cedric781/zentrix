import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { BetStatus } from "@prisma/client";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { mapDomainError } from "@/lib/http/errors";
import { listBetsAdmin } from "@/lib/bets/read";
import { parseAdminListQuery } from "@/lib/http/query";
import { serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BetStatusEnum = z.enum(
  Object.values(BetStatus) as [string, ...string[]],
);

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return new Response("unauthorized", { status: 401 });
    }
    throw err;
  }

  try {
    const parsed = parseAdminListQuery(req, BetStatusEnum);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { status, offset, take, searchQ } = parsed.data;
    const result = await listBetsAdmin({
      status: status as BetStatus | undefined,
      offset,
      take,
      searchQ,
    });
    return NextResponse.json({
      items: result.items.map(serializeBet),
      total: result.total,
      offset: result.offset,
      take: result.take,
      hasMore: result.hasMore,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
