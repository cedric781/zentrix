import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { getPrivyServerClient } from "@/lib/privy/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client posts {delegated: true} as a hint after Privy's addSigners() resolves.
// We never trust the client claim — we re-verify by asking Privy directly and
// persist the resulting truth.
const Body = z.object({
  delegated: z.boolean().optional(),
});

type SuccessBody = { success: true; walletDelegatedAt: string | null };
type FailureBody = {
  success: false;
  error: { code: string; message: string; details?: { cause?: string } };
};

export async function POST(req: Request) {
  let me;
  try {
    me = await requireCurrentUser();
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json<FailureBody>(
      {
        success: false,
        error: { code: "BAD_BODY", message: "Invalid request body" },
      },
      { status: 400 },
    );
  }

  const privy = getPrivyServerClient();
  let privyUser;
  try {
    privyUser = await privy.getUserById(me.privyId);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: cause, userId: me.id },
      "delegation-status: Privy getUserById failed",
    );
    return NextResponse.json<FailureBody>(
      {
        success: false,
        error: {
          code: "PRIVY_UNREACHABLE",
          message: "Could not verify wallet authorization with Privy. Try again.",
          details: { cause: cause.slice(0, 200) },
        },
      },
      { status: 502 },
    );
  }

  const solWallet = privyUser?.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      "chainType" in a &&
      a.chainType === "solana" &&
      "walletClientType" in a &&
      a.walletClientType === "privy",
  ) as { delegated?: boolean } | undefined;

  const isDelegated = Boolean(solWallet?.delegated);
  const before = me.walletDelegatedAt;
  let walletDelegatedAt: Date | null = before;

  if (isDelegated && !before) {
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: { walletDelegatedAt: new Date() },
      select: { walletDelegatedAt: true },
    });
    walletDelegatedAt = updated.walletDelegatedAt;
    logger.info({ userId: me.id }, "delegation-status: now AUTHORIZED");
  } else if (!isDelegated && before) {
    await prisma.user.update({
      where: { id: me.id },
      data: { walletDelegatedAt: null },
    });
    walletDelegatedAt = null;
    logger.warn(
      { userId: me.id },
      "delegation-status: REVOKED upstream — DB cleared",
    );
  }

  return NextResponse.json<SuccessBody>({
    success: true,
    walletDelegatedAt: walletDelegatedAt?.toISOString() ?? null,
  });
}
