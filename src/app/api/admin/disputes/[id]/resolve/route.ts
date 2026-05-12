import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import { resolveDispute } from "@/lib/disputes/service";
import { serializeDispute } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResolveDisputeBody = z.object({
  outcome: z.enum(["CREATOR_WINS", "OPPONENT_WINS", "VOID"]),
  reasoning: z.string().min(10).max(2000),
  actorAdminId: z.string().uuid("Invalid admin UUID"),
});

export async function POST(
  req: Request,
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

  let idempotencyKey: string;
  try {
    idempotencyKey = parseIdempotencyKey(req);
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }

  const parsed = ResolveDisputeBody.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { id } = await ctx.params;
    const result = await resolveDispute({
      disputeId: id,
      adminId: parsed.data.actorAdminId,
      outcome: parsed.data.outcome,
      adminNotes: parsed.data.reasoning,
      idempotencyKey,
    });
    return NextResponse.json({ data: serializeDispute(result.dispute) });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
