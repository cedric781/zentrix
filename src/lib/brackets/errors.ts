import "server-only";

/**
 * BracketError — domain error for bracket-generation logic + bracket services.
 *
 * Generation-time codes (src/lib/brackets/generator.ts):
 *   BRACKET_INVALID_FORMAT          — format is SIMPLE (no generation) or unknown.
 *   BRACKET_INVALID_PARTICIPANT_COUNT — N outside supported range for the chosen format.
 *   BRACKET_INVALID_SEEDS           — seeds are not a dense 1..N permutation.
 *   BRACKET_UNSUPPORTED_FOR_FORMAT  — currently emitted when DOUBLE_ELIM is requested
 *                                     with a non-power-of-2 participant count.
 *                                     Double-elim with byes is deferred because
 *                                     community conventions diverge on the exact
 *                                     dropdown-round placement. Callers should pad
 *                                     to the next power of two or use SINGLE_ELIM.
 *
 * Service-time codes (src/lib/brackets/service.ts):
 *   BRACKET_PARTICIPANT_NOT_FOUND   — removeParticipant for an unknown participantId.
 *   BRACKET_INVALID_INPUT           — displayName length out of range, seed out of
 *                                     [1..64], or already-taken seed.
 *
 * Lock-time codes (src/lib/brackets/service.ts lockBracket):
 *   BRACKET_ALREADY_LOCKED          — lockBracket called when pool.bracketLockedAt
 *                                     is already set. Idempotency-key replay returns
 *                                     the cached payload instead; this fires on a
 *                                     fresh key against an already-locked pool.
 *   BRACKET_NOT_READY               — participant count insufficient for the chosen
 *                                     format (passes through from generator's
 *                                     BRACKET_INVALID_PARTICIPANT_COUNT / SEEDS /
 *                                     UNSUPPORTED_FOR_FORMAT — distinct service-level
 *                                     code is reserved for future pre-flight checks).
 *   BRACKET_MATCHES_NOT_EMPTY       — defensive: pool already has matches when
 *                                     lockBracket runs. Should be impossible if
 *                                     addMatchToPool's tournamentFormat guard worked,
 *                                     but catches data left over from earlier states.
 */
export type BracketErrorCode =
  | "BRACKET_INVALID_FORMAT"
  | "BRACKET_INVALID_PARTICIPANT_COUNT"
  | "BRACKET_INVALID_SEEDS"
  | "BRACKET_UNSUPPORTED_FOR_FORMAT"
  | "BRACKET_PARTICIPANT_NOT_FOUND"
  | "BRACKET_INVALID_INPUT"
  | "BRACKET_ALREADY_LOCKED"
  | "BRACKET_NOT_READY"
  | "BRACKET_MATCHES_NOT_EMPTY";

export class BracketError extends Error {
  constructor(
    public code: BracketErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "BracketError";
  }
}
