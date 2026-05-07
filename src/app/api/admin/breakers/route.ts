import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, AdminAuthError } from "@/lib/admin";
import { listCircuits, tripCircuit, resetCircuit } from "@/lib/circuit-breaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return new Response("unauthorized", { status: 401 });
    }
    throw e;
  }

  const breakers = await listCircuits();
  return NextResponse.json(
    breakers.map((b) => ({
      id: b.id,
      key: b.key,
      isOpen: b.isOpen,
      reason: b.reason,
      openedBy: b.openedBy,
      tripCount: b.tripCount,
      openedAt: b.openedAt?.toISOString() ?? null,
      closedAt: b.closedAt?.toISOString() ?? null,
      lastTripAt: b.lastTripAt?.toISOString() ?? null,
      updatedAt: b.updatedAt.toISOString(),
    })),
  );
}

const Body = z.object({
  key: z.enum(["deposits", "withdrawals", "settlement"]),
  action: z.enum(["trip", "reset"]),
  reason: z.string().max(500).optional(),
  by: z.string().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return new Response("unauthorized", { status: 401 });
    }
    throw e;
  }

  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_body", issues: body.error.issues },
      { status: 400 },
    );
  }

  const { key, action, reason, by } = body.data;
  if (action === "trip") {
    await tripCircuit(key, reason ?? "manual", by ?? "admin");
  } else {
    await resetCircuit(key, by ?? "admin");
  }
  return NextResponse.json({ ok: true });
}
