import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { mapDomainError } from "@/lib/http/errors";
import { listUsersAdmin } from "@/lib/admin/users";
import {
  serializeUserAdmin,
  serializePagination,
} from "@/lib/http/serialize";

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
    const items = result.items.map(serializeUserAdmin);
    return NextResponse.json(
      serializePagination(items, {
        total: result.total,
        offset: result.offset,
        take: result.take,
        hasMore: result.hasMore,
      }),
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
