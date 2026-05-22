import "server-only";
import { prisma } from "@/lib/prisma";
import { lockBet } from "@/lib/bets/service";
import { computeTokenHash, generateInviteToken } from "./token";
import { InviteError } from "./errors";

export interface RegenerateBetInviteInput {
  betId: string;
  userId: string;
  expiresInMs: number;
}

export interface RegenerateBetInviteResult {
  tokenPlain: string;
  expiresAt: Date;
}

export async function regenerateBetInvite(
  input: RegenerateBetInviteInput,
): Promise<RegenerateBetInviteResult> {
  const { betId, userId, expiresInMs } = input;

  return await prisma.$transaction(async (tx) => {
    await lockBet(tx, betId);

    const bet = await tx.bet.findUnique({
      where: { id: betId },
      include: { invite: true },
    });
    if (!bet) {
      throw new InviteError("INVITE_NOT_FOUND", `Bet ${betId} not found`, 404);
    }
    if (bet.createdById !== userId) {
      throw new InviteError(
        "INVITE_UNAUTHORIZED",
        "Only the bet creator can regenerate the invite",
        403,
      );
    }
    if (bet.status !== "OPEN") {
      throw new InviteError(
        "INVITE_BET_NOT_OPEN",
        `Bet not accepting invites (status=${bet.status})`,
        409,
      );
    }
    if (!bet.invite) {
      throw new InviteError(
        "INVITE_NOT_FOUND",
        `No invite exists for bet ${betId}`,
        404,
      );
    }
    if (bet.invite.usedAt !== null) {
      throw new InviteError(
        "INVITE_ALREADY_USED",
        "Invite already redeemed, cannot regenerate",
        409,
      );
    }

    const tokenPlain = generateInviteToken();
    const tokenHash = computeTokenHash(tokenPlain);
    const expiresAt = new Date(Date.now() + expiresInMs);

    await tx.betInvite.update({
      where: { betId },
      data: {
        tokenHash,
        expiresAt,
        usedAt: null,
        usedById: null,
      },
    });

    return { tokenPlain, expiresAt };
  });
}
