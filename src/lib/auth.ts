import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getPrivyServerClient } from "@/lib/privy/server";
import { logger } from "@/lib/logger";
import type { User } from "@prisma/client";

/**
 * Verifies the Privy access token from cookies, ensures a local User row
 * exists (idempotent), and returns the User. Returns null if no valid token.
 *
 * MUST be called from server context only. NEVER from client components.
 *
 * Idempotent on privyId: re-calls return the same User row without creating
 * a duplicate. The User + FinancialAccount creation happens in a single
 * Prisma transaction so we never end up with a User without an account.
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const tokenCookie = cookieStore.get("privy-token");
  if (!tokenCookie?.value) return null;

  const privy = getPrivyServerClient();

  let claims;
  try {
    claims = await privy.verifyAuthToken(tokenCookie.value);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "privy token verification failed");
    return null;
  }

  const privyId = claims.userId;
  if (!privyId) return null;

  const existing = await prisma.user.findUnique({ where: { privyId } });
  if (existing) return existing;

  const privyUser = await privy.getUserById(privyId).catch(() => null);
  const email = privyUser?.email?.address ?? privyUser?.google?.email ?? null;
  const embeddedWallet = privyUser?.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      "chainType" in a &&
      a.chainType === "solana" &&
      "walletClientType" in a &&
      a.walletClientType === "privy",
  );
  const embeddedAddress =
    embeddedWallet && "address" in embeddedWallet ? (embeddedWallet.address as string) : null;

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.upsert({
      where: { privyId },
      create: {
        privyId,
        email,
        embeddedWalletAddress: embeddedAddress,
      },
      update: {},
    });

    await tx.financialAccount.upsert({
      where: { scopeKey: `user:${u.id}` },
      create: {
        accountType: "USER",
        scopeKey: `user:${u.id}`,
        userId: u.id,
        label: `User ${u.id} balance`,
      },
      update: {},
    });

    return u;
  });

  logger.info(
    { userId: user.id, privyId, hasEmail: !!email, hasWallet: !!embeddedAddress },
    "user provisioned",
  );
  return user;
}

/** Like getCurrentUser but throws 401 — for API routes that require auth. */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}