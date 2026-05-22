import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { regenerateBetInvite } from "@/lib/invites/service";
import { mapDomainError } from "@/lib/http/errors";

export const runtime = "nodejs";

const MAX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

const Body = z.object({
  expiresInMs: z.number().int().positive().max(MAX_EXPIRY_MS).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: betId } = await params;

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
    const { tokenPlain, expiresAt } = await regenerateBetInvite({
      betId,
      userId: user.id,
      expiresInMs: parsed.data.expiresInMs,
    });

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? "https://zentrix-sandy.vercel.app";
    const inviteUrl = `${baseUrl}/invite/${tokenPlain}`;

    return NextResponse.json({
      tokenPlain,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
