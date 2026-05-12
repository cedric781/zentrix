import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { submitDisputeEvidence } from "@/lib/disputes/service";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import { serializeDispute } from "@/lib/http/serialize";

export const runtime = "nodejs";

const EvidenceItem = z.object({
  type: z.enum(["TEXT", "URL", "IMAGE", "VIDEO"]),
  fileUrl: z.string().url().optional(),
  contentHash: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
});

const Body = z.object({
  items: z.array(EvidenceItem).min(1).max(10),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: disputeId } = await params;

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

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await submitDisputeEvidence({
      disputeId,
      uploaderId: user.id,
      items: parsed.data.items,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        dispute: serializeDispute(result.dispute),
        evidenceAdded: result.evidenceAdded,
        evidenceTotal: result.evidenceTotal,
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
