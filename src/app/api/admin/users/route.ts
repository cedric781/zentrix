import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { mapDomainError } from "@/lib/http/errors";
import { listUsersAdmin } from "@/lib/admin/users";
import { bigToStr } from "@/lib/http/bigint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UsersQuery = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  take: z.coerce.number().int().min(1).max(100).optional().default(25),
  searchQ: z.string().max(200).optional(),
});

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
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = UsersQuery.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { offset, take, searchQ } = parsed.data;
    const result = await listUsersAdmin({ offset, take, searchQ });
    return NextResponse.json({
      items: result.items.map((u) => ({
        id: u.id,
        privyId: u.privyId,
        email: u.email,
        embeddedWalletAddress: u.embeddedWalletAddress,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
        financialAccount: u.financialAccount
          ? {
              id: u.financialAccount.id,
              accountType: u.financialAccount.accountType,
              balanceUnits: bigToStr(u.financialAccount.balanceUnits),
              updatedAt: u.financialAccount.updatedAt.toISOString(),
            }
          : null,
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
