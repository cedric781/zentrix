import "server-only";
import { Prisma, type Match } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type TxClient } from "@/lib/ledger";
import { lockPool, IDEMPOTENCY_TTL_MS } from "@/lib/pools/service";
import { MatchError } from "./errors";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const TITLE_MIN = 1;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const EVIDENCE_MAX = 10;
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AddMatchToPoolInput {
  poolId: string;
  callerId: string;
  title: string;
  description?: string;
  eventTime?: Date;
  idempotencyKey: string;
}

export interface AddMatchToPoolResult {
  match: Match;
}

export type SubmitMatchEvidenceItem = {
  type: "TEXT" | "URL" | "IMAGE" | "VIDEO";
  fileUrl?: string;
  mimeType?: string;
  contentHash: string;
  description?: string;
};

export interface SubmitMatchResultInput {
  matchId: string;
  callerId: string;
  winnerSide: "A" | "B";
  evidence?: SubmitMatchEvidenceItem[];
  idempotencyKey: string;
}

export interface SubmitMatchResultResult {
  match: Match;
  evidenceCount: number;
}

export interface DeleteMatchInput {
  matchId: string;
  callerId: string;
  idempotencyKey: string;
}

export interface DeleteMatchResult {
  deleted: boolean;
}

// ── helpers ──────────────────────────────────────────────────────────

export async function lockMatch(
  tx: TxClient,
  matchId: string,
): Promise<{ id: string }> {
  const rows = (await tx.$queryRaw`
    SELECT id FROM matches WHERE id = ${matchId} FOR UPDATE
  `) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new MatchError("MATCH_NOT_FOUND", `match ${matchId} not found`, 404);
  }
  return { id: rows[0].id };
}

function assertUuidV4(key: string, fieldName: string): void {
  if (!UUID_V4.test(key)) {
    throw new MatchError(
      "MATCH_INVALID_INPUT",
      `${fieldName} must be a UUID v4`,
      400,
    );
  }
}

/**
 * Generic idempotency-record lookup keyed by namespaced UUIDv4.
 *
 * TECH-DEBT: this and recordMatchIdempotency belong in a shared
 * `src/lib/idempotency/db.ts` module — reused by matches and brackets
 * services. Promoted to exports here as a bridge until that refactor lands.
 */
export async function findReplayedResponse<T extends Prisma.JsonObject>(
  tx: TxClient,
  namespacedKey: string,
): Promise<T | null> {
  const existing = await tx.idempotencyKey.findUnique({
    where: { key: namespacedKey },
  });
  if (!existing) return null;
  if (!existing.responseJson) {
    throw new Error(`IdempotencyKey ${namespacedKey} has no responseJson`);
  }
  return existing.responseJson as T;
}

/**
 * Persist an idempotency record with a JSON response payload.
 *
 * TECH-DEBT: see findReplayedResponse — pending move to shared module.
 */
export async function recordMatchIdempotency(
  tx: TxClient,
  namespacedKey: string,
  scope: string,
  userId: string,
  responseJson: Prisma.InputJsonValue,
): Promise<void> {
  await tx.idempotencyKey.create({
    data: {
      key: namespacedKey,
      scope,
      userId,
      responseJson,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
  });
}

// ── addMatchToPool ───────────────────────────────────────────────────

export async function addMatchToPool(
  input: AddMatchToPoolInput,
): Promise<AddMatchToPoolResult> {
  const { poolId, callerId, title, description, eventTime, idempotencyKey } =
    input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const trimmedTitle = title.trim();
  if (trimmedTitle.length < TITLE_MIN || trimmedTitle.length > TITLE_MAX) {
    throw new MatchError(
      "MATCH_INVALID_INPUT",
      `title length must be ${TITLE_MIN}-${TITLE_MAX}, got ${trimmedTitle.length}`,
      400,
    );
  }
  const trimmedDescription = description?.trim();
  if (
    trimmedDescription !== undefined &&
    trimmedDescription.length > DESCRIPTION_MAX
  ) {
    throw new MatchError(
      "MATCH_INVALID_INPUT",
      `description length must be ≤${DESCRIPTION_MAX}, got ${trimmedDescription.length}`,
      400,
    );
  }
  if (eventTime !== undefined) {
    if (!(eventTime instanceof Date) || Number.isNaN(eventTime.getTime())) {
      throw new MatchError(
        "MATCH_INVALID_INPUT",
        "eventTime must be a valid Date",
        400,
      );
    }
    if (eventTime.getTime() <= Date.now()) {
      throw new MatchError(
        "MATCH_INVALID_INPUT",
        "eventTime must be in the future",
        400,
      );
    }
  }

  const namespacedKey = `match-add:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedResponse<{ matchId: string }>(
      tx,
      namespacedKey,
    );
    if (replayed) {
      const match = await tx.match.findUniqueOrThrow({
        where: { id: replayed.matchId },
      });
      return { match };
    }

    await lockPool(tx, poolId);
    const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });

    if (pool.createdById !== callerId) {
      throw new MatchError(
        "MATCH_NOT_OWNED_BY_POOL_CREATOR",
        "only the pool creator can add matches",
        403,
      );
    }
    if (pool.status !== "OPEN") {
      throw new MatchError(
        "MATCH_NOT_IN_OPEN_POOL",
        `pool not OPEN (status=${pool.status})`,
        409,
      );
    }

    const match = await tx.match.create({
      data: {
        poolId,
        title: trimmedTitle,
        description: trimmedDescription ?? null,
        eventTime: eventTime ?? null,
        status: "SCHEDULED",
      },
    });

    await recordMatchIdempotency(
      tx,
      namespacedKey,
      "match-add",
      callerId,
      { matchId: match.id } as Prisma.InputJsonValue,
    );

    return { match };
  });
}

// ── submitMatchResult ────────────────────────────────────────────────

function validateEvidenceItem(
  item: SubmitMatchEvidenceItem,
  index: number,
): void {
  const allowed = ["TEXT", "URL", "IMAGE", "VIDEO"] as const;
  if (!allowed.includes(item.type)) {
    throw new MatchError(
      "MATCH_INVALID_INPUT",
      `evidence[${index}].type must be one of TEXT|URL|IMAGE|VIDEO`,
      400,
    );
  }
  if (typeof item.contentHash !== "string" || !SHA256_HEX.test(item.contentHash)) {
    throw new MatchError(
      "MATCH_INVALID_INPUT",
      `evidence[${index}].contentHash must be 64-char sha256 hex`,
      400,
    );
  }
  if (item.type === "TEXT") {
    if (item.fileUrl !== undefined && item.fileUrl !== null) {
      throw new MatchError(
        "MATCH_INVALID_INPUT",
        `evidence[${index}].fileUrl must be empty for TEXT type`,
        400,
      );
    }
  } else {
    if (typeof item.fileUrl !== "string" || item.fileUrl.length === 0) {
      throw new MatchError(
        "MATCH_INVALID_INPUT",
        `evidence[${index}].fileUrl required for type=${item.type}`,
        400,
      );
    }
  }
}

export async function submitMatchResult(
  input: SubmitMatchResultInput,
): Promise<SubmitMatchResultResult> {
  const { matchId, callerId, winnerSide, evidence, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");
  if (winnerSide !== "A" && winnerSide !== "B") {
    throw new MatchError(
      "MATCH_INVALID_INPUT",
      `winnerSide must be "A" or "B"`,
      400,
    );
  }
  if (evidence !== undefined) {
    if (!Array.isArray(evidence) || evidence.length > EVIDENCE_MAX) {
      throw new MatchError(
        "MATCH_INVALID_INPUT",
        `evidence must be array with ≤${EVIDENCE_MAX} items`,
        400,
      );
    }
    evidence.forEach(validateEvidenceItem);
  }

  const namespacedKey = `match-submit-result:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedResponse<{
      matchId: string;
      winnerSide: string;
      evidenceCount: number;
    }>(tx, namespacedKey);
    if (replayed) {
      const match = await tx.match.findUniqueOrThrow({
        where: { id: replayed.matchId },
      });
      return { match, evidenceCount: replayed.evidenceCount };
    }

    await lockMatch(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
    const pool = await tx.pool.findUniqueOrThrow({
      where: { id: match.poolId },
    });

    if (match.status !== "SCHEDULED") {
      if (match.status === "RESULT_SUBMITTED") {
        throw new MatchError(
          "MATCH_RESULT_ALREADY_SUBMITTED",
          `match ${matchId} already has a submitted result`,
          409,
        );
      }
      throw new MatchError(
        "MATCH_INVALID_STATUS",
        `cannot submit result from status=${match.status}`,
        409,
      );
    }
    if (pool.createdById !== callerId) {
      throw new MatchError(
        "MATCH_NOT_OWNED_BY_POOL_CREATOR",
        "only the pool creator can submit results",
        403,
      );
    }
    if (pool.status !== "OPEN" && pool.status !== "CLOSED") {
      throw new MatchError(
        "MATCH_NOT_IN_OPEN_POOL",
        `pool must be OPEN or CLOSED for result submission (status=${pool.status})`,
        409,
      );
    }

    const submittedAt = new Date();
    const disputeWindowEndsAt = new Date(
      submittedAt.getTime() + DISPUTE_WINDOW_MS,
    );
    const updated = await tx.match.updateMany({
      where: { id: matchId, status: "SCHEDULED" },
      data: {
        status: "RESULT_SUBMITTED",
        winnerSide,
        submittedAt,
        disputeWindowEndsAt,
      },
    });
    if (updated.count !== 1) {
      throw new MatchError(
        "MATCH_VERSION_MISMATCH",
        `match ${matchId} concurrently mutated`,
        409,
      );
    }

    if (evidence && evidence.length > 0) {
      const seen = new Set<string>();
      for (const item of evidence) {
        if (seen.has(item.contentHash)) continue;
        seen.add(item.contentHash);
        await tx.matchEvidence.create({
          data: {
            matchId,
            uploadedById: callerId,
            type: item.type,
            fileUrl: item.fileUrl ?? null,
            mimeType: item.mimeType ?? null,
            contentHash: item.contentHash,
            description: item.description ?? null,
          },
        });
      }
    }

    const evidenceCount = await tx.matchEvidence.count({ where: { matchId } });

    await recordMatchIdempotency(
      tx,
      namespacedKey,
      "match-submit-result",
      callerId,
      { matchId, winnerSide, evidenceCount } as Prisma.InputJsonValue,
    );

    const finalMatch = await tx.match.findUniqueOrThrow({
      where: { id: matchId },
    });
    return { match: finalMatch, evidenceCount };
  });
}

// ── deleteMatch ──────────────────────────────────────────────────────

export async function deleteMatch(
  input: DeleteMatchInput,
): Promise<DeleteMatchResult> {
  const { matchId, callerId, idempotencyKey } = input;

  assertUuidV4(idempotencyKey, "idempotencyKey");

  const namespacedKey = `match-delete:${idempotencyKey}`;

  return await prisma.$transaction(async (tx) => {
    const replayed = await findReplayedResponse<{ deleted: boolean }>(
      tx,
      namespacedKey,
    );
    if (replayed) return { deleted: replayed.deleted };

    await lockMatch(tx, matchId);
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
    const pool = await tx.pool.findUniqueOrThrow({
      where: { id: match.poolId },
    });

    if (pool.createdById !== callerId) {
      throw new MatchError(
        "MATCH_NOT_OWNED_BY_POOL_CREATOR",
        "only the pool creator can delete matches",
        403,
      );
    }
    if (match.status !== "SCHEDULED") {
      throw new MatchError(
        "MATCH_INVALID_STATUS",
        `cannot delete match from status=${match.status}`,
        409,
      );
    }
    const betCount = await tx.bet.count({ where: { matchId } });
    if (betCount > 0) {
      throw new MatchError(
        "MATCH_HAS_UNRESOLVED_BETS",
        `match ${matchId} has ${betCount} attached bets; cannot delete`,
        409,
      );
    }

    await tx.match.delete({ where: { id: matchId } });

    await recordMatchIdempotency(
      tx,
      namespacedKey,
      "match-delete",
      callerId,
      { deleted: true } as Prisma.InputJsonValue,
    );

    return { deleted: true };
  });
}
