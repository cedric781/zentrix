import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PoolStatus } from "@prisma/client";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { listPools } from "@/lib/pools/read";
import { parseListQuery } from "@/lib/http/query";
import { serializePool } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PoolStatusEnum = z.enum(
  Object.values(PoolStatus) as [string, ...string[]],
);

const ScopeEnum = z.enum(["mine", "public"]).default("public");

export async function GET(req: Request) {
  try {
    const user = await requireCurrentUser();
    const parsed = parseListQuery(req, PoolStatusEnum);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const url = new URL(req.url);
    const scopeResult = ScopeEnum.safeParse(
      url.searchParams.get("scope") ?? undefined,
    );
    if (!scopeResult.success) {
      return NextResponse.json(
        { error: "bad_query", issues: scopeResult.error.issues },
        { status: 400 },
      );
    }
    const scope = scopeResult.data;

    const { status, cursor, take } = parsed.data;
    const result = await listPools({
      scope,
      userId: scope === "mine" ? user.id : undefined,
      status: status as PoolStatus | undefined,
      cursor,
      take,
    });
    return NextResponse.json({
      items: result.items.map(serializePool),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
