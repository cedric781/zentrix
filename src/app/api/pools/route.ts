import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PoolStatus } from "@prisma/client";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { listPools } from "@/lib/pools/read";
import { createPool } from "@/lib/pools/service";
import { parseListQuery } from "@/lib/http/query";
import { serializePool } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PoolStatusEnum = z.enum(
  Object.values(PoolStatus) as [string, ...string[]],
);

const ScopeEnum = z.enum(["mine", "public"]).default("public");

const CreatePoolBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  bettingClosesAt: z.string().datetime(),
});

export async function POST(req: Request) {
  let idempotencyKey: string;
  try {
    idempotencyKey = parseIdempotencyKey(req);
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }

  let user;
  try {
    user = await requireCurrentUser();
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }

  const parsed = CreatePoolBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await createPool({
      creatorId: user.id,
      title: parsed.data.title,
      description: parsed.data.description,
      bettingClosesAt: new Date(parsed.data.bettingClosesAt),
      idempotencyKey,
    });
    return NextResponse.json(
      { data: serializePool(result.pool) },
      {
        status: 201,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}

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
