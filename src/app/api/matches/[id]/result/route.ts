import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { submitMatchResult } from "@/lib/matches/service";
import { parseIdempotencyKey } from "@/lib/http/idempotency";
import { mapDomainError } from "@/lib/http/errors";
import { serializeMatch } from "@/lib/http/serialize";

export const runtime = "nodejs";

const MatchEvidenceItem = z.object({
  type: z.enum(["TEXT", "URL", "IMAGE", "VIDEO"]),
  fileUrl: z.string().url().optional(),
  mimeType: z.string().max(128).optional(),
  contentHash: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
});

const Body = z.object({
  winnerSide: z.enum(["A", "B"]),
  evidence: z.array(MatchEvidenceItem).max(10).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: matchId } = await params;

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
    const result = await submitMatchResult({
      matchId,
      callerId: user.id,
      winnerSide: parsed.data.winnerSide,
      evidence: parsed.data.evidence,
      idempotencyKey,
    });

    return NextResponse.json(
      {
        match: serializeMatch(result.match),
        evidenceCount: result.evidenceCount,
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
