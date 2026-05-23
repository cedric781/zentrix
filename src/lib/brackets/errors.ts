import "server-only";

/**
 * BracketError — domain error for bracket-generation logic.
 *
 * Codes:
 *   BRACKET_INVALID_FORMAT          — format is SIMPLE (no generation) or unknown.
 *   BRACKET_INVALID_PARTICIPANT_COUNT — N outside supported range for the chosen format.
 *   BRACKET_INVALID_SEEDS           — seeds are not a dense 1..N permutation.
 *   BRACKET_UNSUPPORTED_FOR_FORMAT  — currently emitted when DOUBLE_ELIM is requested
 *                                     with a non-power-of-2 participant count.
 *                                     Double-elim with byes is deferred because
 *                                     community conventions diverge on the exact
 *                                     dropdown-round placement. Callers should pad
 *                                     to the next power of two or use SINGLE_ELIM.
 */
export type BracketErrorCode =
  | "BRACKET_INVALID_FORMAT"
  | "BRACKET_INVALID_PARTICIPANT_COUNT"
  | "BRACKET_INVALID_SEEDS"
  | "BRACKET_UNSUPPORTED_FOR_FORMAT";

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
