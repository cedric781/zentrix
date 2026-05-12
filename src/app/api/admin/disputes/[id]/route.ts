import "server-only";
import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { mapDomainError } from "@/lib/http/errors";
import { getDispute } from "@/lib/disputes/read";
import { serializeDispute, serializeBet } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return new Response("unauthorized", { status: 401 });
    }
    throw err;
  }

  try {
    const { id } = await ctx.params;
    const dispute = await getDispute({ id });
    if (!dispute) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      data: {
        ...serializeDispute(dispute),
        bet: serializeBet(dispute.bet),
      },
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
