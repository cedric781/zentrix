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
  if (existing) {
    // Privy delivers embedded Solana wallets asynchronously, so a User row
    // created before the wallet was provisioned will have null fields. Re-fetch
    // from Privy when anything is missing and backfill — never overwrite a
    // value that's already set.
    if (existing.email === null || existing.embeddedWalletAddress === null) {
      const privyUser = await privy.getUserById(privyId).catch(() => null);
      const { email, embeddedAddress } = extractPrivyProfile(privyUser);

      const updates: { email?: string; embeddedWalletAddress?: string } = {};
      if (existing.email === null && email) updates.email = email;
      if (existing.embeddedWalletAddress === null && embeddedAddress) {
        updates.embeddedWalletAddress = embeddedAddress;
      }

      if (Object.keys(updates).length > 0) {
        const updated = await prisma.user.update({
          where: { id: existing.id },
          data: updates,
        });
        logger.info(
          { userId: updated.id, fields: Object.keys(updates) },
          "user backfilled from privy",
        );
        return updated;
      }
    }
    return existing;
  }

  const privyUser = await privy.getUserById(privyId).catch(() => null);
  const { email, embeddedAddress } = extractPrivyProfile(privyUser);

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

type PrivyUser = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getPrivyServerClient>["getUserById"]>>
>;

function extractPrivyProfile(
  privyUser: PrivyUser | null,
): { email: string | null; embeddedAddress: string | null } {
  if (!privyUser) return { email: null, embeddedAddress: null };
  const email = privyUser.email?.address ?? privyUser.google?.email ?? null;
  const embeddedWallet = privyUser.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      "chainType" in a &&
      a.chainType === "solana" &&
      "walletClientType" in a &&
      a.walletClientType === "privy",
  );
  const embeddedAddress =
    embeddedWallet && "address" in embeddedWallet ? (embeddedWallet.address as string) : null;
  return { email, embeddedAddress };
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