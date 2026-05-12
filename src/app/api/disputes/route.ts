import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DisputeStatus } from "@prisma/client";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { listDisputes } from "@/lib/disputes/read";
import { parseListQuery } from "@/lib/http/query";
import { serializeDispute, serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DisputeStatusEnum = z.enum(
  Object.values(DisputeStatus) as [string, ...string[]],
);

export async function GET(req: Request) {
  try {
    const user = await requireCurrentUser();
    const parsed = parseListQuery(req, DisputeStatusEnum);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { status, cursor, take } = parsed.data;
    const result = await listDisputes({
      userId: user.id,
      status: status as DisputeStatus | undefined,
      cursor,
      take,
    });
    return NextResponse.json({
      items: result.items.map((d) => ({
        ...serializeDispute(d),
        bet: serializeBet(d.bet),
      })),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
