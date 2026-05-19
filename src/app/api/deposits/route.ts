import { NextResponse } from "next/server";
import { DepositStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/auth";
import { parseListQuery } from "@/lib/http/query";
import { serializeDeposit } from "@/lib/http/serialize";
import { mapDomainError } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DepositStatusEnum = z.enum(
  Object.values(DepositStatus) as [string, ...string[]],
);

/**
 * GET /api/deposits — list current user's own deposits.
 *
 * Auth: required (Privy token via requireCurrentUser).
 * Filtering: optional ?status=PENDING|CREDITED|FAILED.
 * Pagination: cursor + take via parseListQuery.
 * Order: createdAt DESC (newest first).
 *
 * SECURITY: userId is resolved from auth, NEVER from query.
 */
export async function GET(req: Request) {
  try {
    const user = await requireCurrentUser();
    const parsed = parseListQuery(req, DepositStatusEnum);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { status, cursor, take } = parsed.data;

    const deposits = await prisma.deposit.findMany({
      where: {
        userId: user.id,
        ...(status ? { status: status as DepositStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = deposits.length > take;
    const items = hasMore ? deposits.slice(0, take) : deposits;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({
      items: items.map(serializeDeposit),
      nextCursor,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
