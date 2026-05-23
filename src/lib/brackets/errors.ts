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
 *
 * Advance-time codes (src/lib/brackets/service.ts advanceWinnerToBracket):
 *   BRACKET_NOT_LOCKED              — advance attempted on a pool whose bracket
 *                                     hasn't been generated yet (bracketLockedAt is null).
 *   BRACKET_MATCH_NOT_READY         — advance attempted on a match still missing
 *                                     participantA or participantB (upstream TBD).
 *   BRACKET_PARTICIPANT_NOT_PARTICIPANT_OF_MATCH
 *                                   — winnerParticipantId isn't one of the match's
 *                                     two participants. 400.
 *   BRACKET_ADVANCE_ALREADY_RECORDED
 *                                   — next match has both participant slots filled
 *                                     with IDs that don't match the advancing
 *                                     winner/loser. Indicates double-advance with
 *                                     differing keys (or data corruption). 409.
 *   BRACKET_TARGET_FULL             — defensive 500: CAS UPDATE on next match's
 *                                     null slot returned 0 rows after lock + read
 *                                     said the slot was empty. Should be unreachable
 *                                     under SELECT FOR UPDATE; presence indicates
 *                                     a serious lock-discipline bug.
 *
 * INTENTIONAL LIMITATION (F3 MVP): bracket matches go directly SCHEDULED →
 * SETTLED via advanceWinnerToBracket. No dispute window. Disputes on bracket
 * matches require a freezable advance-undo mechanism deferred to a future phase
 * (would let a dispute roll back already-propagated participants in next-round
 * matches).
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
  | "BRACKET_MATCHES_NOT_EMPTY"
  | "BRACKET_NOT_LOCKED"
  | "BRACKET_MATCH_NOT_READY"
  | "BRACKET_PARTICIPANT_NOT_PARTICIPANT_OF_MATCH"
  | "BRACKET_ADVANCE_ALREADY_RECORDED"
  | "BRACKET_TARGET_FULL";

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
