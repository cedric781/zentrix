import { NextResponse } from "next/server";
import { getInviteByToken } from "@/lib/invites/service";
import { TOKEN_HEX } from "@/lib/invites/token";
import { bigToStr } from "@/lib/http/bigint";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "INVITE_NOT_FOUND" }, { status: 404 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!TOKEN_HEX.test(token)) {
    return notFound();
  }

  const invite = await getInviteByToken({ tokenPlain: token });
  if (!invite) {
    return notFound();
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return notFound();
  }

  const { bet } = invite;

  return NextResponse.json({
    bet: {
      id: bet.id,
      title: bet.title,
      status: bet.status,
      stakeUnits: bigToStr(bet.stakeUnits),
      creatorSide: bet.creatorSide,
      outcomeA: bet.outcomeA,
      outcomeB: bet.outcomeB,
    },
    expiresAt: invite.expiresAt.toISOString(),
    alreadyUsed: invite.usedAt !== null,
  });
}
