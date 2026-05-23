import "server-only";
import { BracketError } from "./errors";

/**
 * Bracket generator — pure-function service.
 *
 * Builds the match tree for a tournament pool given participants + format.
 * Returns PlannedMatch[] with stable `slotKey` identifiers so a caller
 * (F3 service layer) can allocate UUIDs and persist via createMany +
 * a follow-up UPDATE pass to wire `nextMatchIdOnWin/Loss` FKs.
 *
 * No Prisma, no DB, no I/O. Deterministic for a given input.
 *
 * Format scope:
 *   - SINGLE_ELIM: N 2..64. Byes auto-handled (top seeds bye into R2 etc.)
 *   - DOUBLE_ELIM: N must be a power of 2 (2, 4, 8, 16, 32, 64).
 *     Non-pow2 → BRACKET_UNSUPPORTED_FOR_FORMAT.
 *     No grand-final bracket-reset — LB winner must beat WB winner once.
 *
 * Bracket field meaning:
 *   - WINNERS: WB matches (incl. WBF in DE; everything except the deciding match in SE)
 *   - LOSERS:  LB matches (incl. LBF)
 *   - FINAL:   tournament-deciding match (SE's WF, DE's GF)
 */

export type BracketSide = "WINNERS" | "LOSERS" | "FINAL";

export type BracketFormat = "SINGLE_ELIM" | "DOUBLE_ELIM";

export type BracketParticipant = {
  id: string;
  seed: number;
  displayName: string;
};

export type GenerateBracketsInput = {
  participants: BracketParticipant[];
  format: BracketFormat;
};

export type PlannedMatch = {
  /** Stable identifier within the plan (e.g., "WB-R1-M1", "WF", "WBF", "LB-R2-M1", "LBF", "GF"). */
  slotKey: string;
  /** Generic human-readable title; caller may override before persisting. */
  title: string;
  bracket: BracketSide;
  /** Short display label (e.g., "R1M1", "WF", "WBF", "LBR2M1", "LBF", "GF"). */
  bracketSlot: string;
  /** 1-indexed position within the match's own bracket (WINNERS / LOSERS / FINAL). */
  round: number;
  participantAId: string | null;
  participantBId: string | null;
  nextOnWinSlotKey: string | null;
  nextOnLossSlotKey: string | null;
};

export type GenerateBracketsResult = {
  matches: PlannedMatch[];
};

const SE_MIN = 2;
const SE_MAX = 64;
const DE_MIN = 2;
const DE_MAX = 64;

// ── public API ───────────────────────────────────────────────────────

export function generateBrackets(
  input: GenerateBracketsInput,
): GenerateBracketsResult {
  validateInput(input);

  if (input.format === "SINGLE_ELIM") {
    return { matches: buildSingleElim(input.participants) };
  }
  return { matches: buildDoubleElim(input.participants) };
}

// ── validation ───────────────────────────────────────────────────────

function validateInput(input: GenerateBracketsInput): void {
  const fmt = input.format as string;
  if (fmt === "SIMPLE") {
    throw new BracketError(
      "BRACKET_INVALID_FORMAT",
      "SIMPLE pools don't use bracket generation",
    );
  }
  if (fmt !== "SINGLE_ELIM" && fmt !== "DOUBLE_ELIM") {
    throw new BracketError(
      "BRACKET_INVALID_FORMAT",
      `format must be SINGLE_ELIM or DOUBLE_ELIM, got ${fmt}`,
    );
  }

  const n = input.participants.length;

  if (input.format === "SINGLE_ELIM") {
    if (n < SE_MIN || n > SE_MAX) {
      throw new BracketError(
        "BRACKET_INVALID_PARTICIPANT_COUNT",
        `SINGLE_ELIM requires ${SE_MIN}-${SE_MAX} participants, got ${n}`,
      );
    }
  } else {
    if (n < DE_MIN || n > DE_MAX) {
      throw new BracketError(
        "BRACKET_INVALID_PARTICIPANT_COUNT",
        `DOUBLE_ELIM requires ${DE_MIN}-${DE_MAX} participants, got ${n}`,
      );
    }
    if (!isPowerOfTwo(n)) {
      throw new BracketError(
        "BRACKET_UNSUPPORTED_FOR_FORMAT",
        `DOUBLE_ELIM requires power-of-2 participant count; got ${n}. Use SINGLE_ELIM or pad to ${nextPowerOfTwo(n)}.`,
      );
    }
  }

  const seeds = input.participants.map((p) => p.seed).sort((a, b) => a - b);
  for (let i = 0; i < seeds.length; i++) {
    if (seeds[i] !== i + 1) {
      throw new BracketError(
        "BRACKET_INVALID_SEEDS",
        `seeds must be 1..${n} dense unique, got [${seeds.join(",")}]`,
      );
    }
  }
}

// ── pure helpers ─────────────────────────────────────────────────────

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 1 << Math.ceil(Math.log2(n));
}

/**
 * Standard snake seeding for a 2^k slot bracket.
 *   seedingOrder(1) = [1]
 *   seedingOrder(2) = [1, 2]
 *   seedingOrder(4) = [1, 4, 2, 3]
 *   seedingOrder(8) = [1, 8, 4, 5, 2, 7, 3, 6]
 *
 * Top seed and bottom seed land on opposite ends of the same half so they
 * can only meet in the final.
 */
function computeSeedingOrder(numSlots: number): number[] {
  if (numSlots === 1) return [1];
  const prev = computeSeedingOrder(numSlots / 2);
  const result: number[] = [];
  for (const s of prev) {
    result.push(s);
    result.push(numSlots + 1 - s);
  }
  return result;
}

// ── carrier abstraction for tree building ─────────────────────────────

type Carrier =
  | { kind: "participant"; participantId: string }
  | { kind: "winnerOf"; slotKey: string }
  | { kind: "loserOf"; slotKey: string };

/**
 * When a carrier is consumed as an input to a new match, the source match
 * (if any) gets its nextOnWin/Loss pointer wired to the new slotKey.
 */
function wireCarrier(
  matchBySlot: Map<string, PlannedMatch>,
  newSlotKey: string,
  c: Carrier,
): string | null {
  if (c.kind === "participant") return c.participantId;
  const src = matchBySlot.get(c.slotKey);
  if (!src) {
    // Should never happen — internal generator invariant.
    throw new Error(
      `wireCarrier: unknown source slotKey '${c.slotKey}' for new '${newSlotKey}'`,
    );
  }
  if (c.kind === "winnerOf") src.nextOnWinSlotKey = newSlotKey;
  else src.nextOnLossSlotKey = newSlotKey;
  return null;
}

// ── SINGLE_ELIM ──────────────────────────────────────────────────────

function buildSingleElim(participants: BracketParticipant[]): PlannedMatch[] {
  const n = participants.length;
  const numSlots = nextPowerOfTwo(n);
  const seedingOrder = computeSeedingOrder(numSlots);
  const bySeed = new Map(participants.map((p) => [p.seed, p]));

  // currentLevel: carriers entering the next round, or null for empty (bye) slots.
  let currentLevel: Array<Carrier | null> = seedingOrder.map((seed) => {
    const p = bySeed.get(seed);
    return p ? { kind: "participant" as const, participantId: p.id } : null;
  });

  const matches: PlannedMatch[] = [];
  const matchBySlot = new Map<string, PlannedMatch>();
  let depth = 1;

  while (currentLevel.length > 1) {
    const isLastRound = currentLevel.length === 2;
    const next: Array<Carrier | null> = [];
    let matchIdx = 1;

    for (let i = 0; i < currentLevel.length; i += 2) {
      const a = currentLevel[i];
      const b = currentLevel[i + 1];

      if (!a && !b) {
        next.push(null);
        continue;
      }
      if (!a) {
        next.push(b);
        continue;
      }
      if (!b) {
        next.push(a);
        continue;
      }

      const slotKey = isLastRound ? "WF" : `WB-R${depth}-M${matchIdx}`;
      const bracketSlot = isLastRound ? "WF" : `R${depth}M${matchIdx}`;
      const title = isLastRound
        ? "Winners Final"
        : `Round ${depth} Match ${matchIdx}`;
      const bracket: BracketSide = isLastRound ? "FINAL" : "WINNERS";
      const round = isLastRound ? 1 : depth;

      const m: PlannedMatch = {
        slotKey,
        title,
        bracket,
        bracketSlot,
        round,
        participantAId: wireCarrier(matchBySlot, slotKey, a),
        participantBId: wireCarrier(matchBySlot, slotKey, b),
        nextOnWinSlotKey: null,
        nextOnLossSlotKey: null,
      };

      matches.push(m);
      matchBySlot.set(slotKey, m);
      next.push({ kind: "winnerOf", slotKey });
      matchIdx++;
    }

    currentLevel = next;
    depth++;
  }

  return matches;
}

// ── DOUBLE_ELIM (power-of-2 only) ─────────────────────────────────────

function buildDoubleElim(participants: BracketParticipant[]): PlannedMatch[] {
  const n = participants.length;
  // Pow2 guaranteed by validation; no byes.
  const seedingOrder = computeSeedingOrder(n);
  const bySeed = new Map(participants.map((p) => [p.seed, p]));

  const matches: PlannedMatch[] = [];
  const matchBySlot = new Map<string, PlannedMatch>();

  const addMatch = (
    slotKey: string,
    title: string,
    bracket: BracketSide,
    bracketSlot: string,
    round: number,
    a: Carrier,
    b: Carrier,
  ): PlannedMatch => {
    const m: PlannedMatch = {
      slotKey,
      title,
      bracket,
      bracketSlot,
      round,
      participantAId: wireCarrier(matchBySlot, slotKey, a),
      participantBId: wireCarrier(matchBySlot, slotKey, b),
      nextOnWinSlotKey: null,
      nextOnLossSlotKey: null,
    };
    matches.push(m);
    matchBySlot.set(slotKey, m);
    return m;
  };

  // === WB ===
  const totalWBRounds = Math.log2(n); // integer for pow2 n
  const wbMatchesByRound: PlannedMatch[][] = [];

  let wbLevel: Carrier[] = seedingOrder.map((seed) => ({
    kind: "participant" as const,
    participantId: bySeed.get(seed)!.id,
  }));

  for (let wbRound = 1; wbRound <= totalWBRounds; wbRound++) {
    const isWBF = wbRound === totalWBRounds;
    const next: Carrier[] = [];
    const thisRound: PlannedMatch[] = [];
    let matchIdx = 1;

    for (let i = 0; i < wbLevel.length; i += 2) {
      const a = wbLevel[i];
      const b = wbLevel[i + 1];
      const slotKey = isWBF ? "WBF" : `WB-R${wbRound}-M${matchIdx}`;
      const bracketSlot = isWBF ? "WBF" : `R${wbRound}M${matchIdx}`;
      const title = isWBF
        ? "Winners Bracket Final"
        : `Round ${wbRound} Match ${matchIdx}`;
      const m = addMatch(slotKey, title, "WINNERS", bracketSlot, wbRound, a, b);
      thisRound.push(m);
      next.push({ kind: "winnerOf", slotKey });
      matchIdx++;
    }

    wbMatchesByRound.push(thisRound);
    wbLevel = next;
  }

  // === LB ===
  // LB rounds = 2 * (totalWBRounds - 1).
  // Round 1: pair WB R1 losers (minor).
  // Round r (r >= 2):
  //   - even r: major — pair previous LB winners with WB(r/2 + 1) losers
  //   - odd r:  minor — pair previous LB winners with each other
  const totalLBRounds = 2 * (totalWBRounds - 1);
  let lbLevel: Carrier[] = [];

  for (let lbRound = 1; lbRound <= totalLBRounds; lbRound++) {
    const isLBF = lbRound === totalLBRounds;
    const next: Carrier[] = [];
    let matchIdx = 1;

    let pairings: Array<[Carrier, Carrier]>;
    if (lbRound === 1) {
      const wbR1 = wbMatchesByRound[0];
      pairings = [];
      for (let i = 0; i < wbR1.length; i += 2) {
        pairings.push([
          { kind: "loserOf", slotKey: wbR1[i].slotKey },
          { kind: "loserOf", slotKey: wbR1[i + 1].slotKey },
        ]);
      }
    } else if (lbRound % 2 === 0) {
      const wbRoundForDropdown = lbRound / 2 + 1;
      const wbMatches = wbMatchesByRound[wbRoundForDropdown - 1];
      pairings = [];
      for (let i = 0; i < lbLevel.length; i++) {
        pairings.push([
          lbLevel[i],
          { kind: "loserOf", slotKey: wbMatches[i].slotKey },
        ]);
      }
    } else {
      pairings = [];
      for (let i = 0; i < lbLevel.length; i += 2) {
        pairings.push([lbLevel[i], lbLevel[i + 1]]);
      }
    }

    for (const [a, b] of pairings) {
      const slotKey = isLBF ? "LBF" : `LB-R${lbRound}-M${matchIdx}`;
      const bracketSlot = isLBF ? "LBF" : `LBR${lbRound}M${matchIdx}`;
      const title = isLBF
        ? "Losers Bracket Final"
        : `Losers Bracket Round ${lbRound} Match ${matchIdx}`;
      const m = addMatch(slotKey, title, "LOSERS", bracketSlot, lbRound, a, b);
      next.push({ kind: "winnerOf", slotKey });
      matchIdx++;
    }

    lbLevel = next;
  }

  // === GF ===
  // WBF winner vs LBF winner. round=1 since FINAL bracket has a single match.
  addMatch(
    "GF",
    "Grand Final",
    "FINAL",
    "GF",
    1,
    { kind: "winnerOf", slotKey: "WBF" },
    { kind: "winnerOf", slotKey: "LBF" },
  );

  return matches;
}
