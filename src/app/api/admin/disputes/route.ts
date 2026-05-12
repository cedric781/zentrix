import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DisputeStatus } from "@prisma/client";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { mapDomainError } from "@/lib/http/errors";
import { listDisputesAdmin } from "@/lib/disputes/read";
import { parseAdminListQuery } from "@/lib/http/query";
import { serializeDispute, serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DisputeStatusEnum = z.enum(
  Object.values(DisputeStatus) as [string, ...string[]],
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
    const parsed = parseAdminListQuery(req, DisputeStatusEnum);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { status, offset, take, searchQ } = parsed.data;
    const result = await listDisputesAdmin({
      status: status as DisputeStatus | undefined,
      offset,
      take,
      searchQ,
    });
    return NextResponse.json({
      items: result.items.map((d) => ({
        ...serializeDispute(d),
        bet: serializeBet(d.bet),
      })),
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
