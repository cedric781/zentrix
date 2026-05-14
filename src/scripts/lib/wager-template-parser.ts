import { readFileSync } from "node:fs";
import { z } from "zod";
import { CreateBetTemplateInputSchema } from "@/lib/templates/schemas";

const WAGER_SOURCE = "/tmp/wager-source/src/templates/templates-library.ts";

// 15 templates we want — hardcoded, no dynamic discovery
export const TARGET_SLUGS = [
  // SPORTS (4)
  "football-match-winner",
  "basketball-game-winner",
  "tennis-match-winner",
  "f1-race-winner",
  // COMBAT (3)
  "mma-match-winner",
  "boxing-match-winner",
  "boxing-goes-distance",
  // ESPORTS (4)
  "lol-match-winner",
  "cs2-match-winner",
  "valorant-match-winner",
  "dota2-match-winner",
  // BOARD_GAMES (4)
  "chess-match-winner",
  "catan-game-winner",
  "poker-tournament-finish",
  "scrabble-match-winner",
] as const;

export const CATEGORY_MAP: Record<string, string> = {
  SPORTS: "Sport",
  COMBAT: "Combat",
  ESPORTS: "Esports",
  BOARD_GAMES: "Games",
};

// Base category inferred from spread reference (...sportsBase / ...combatBase / ...esportsBase / ...boardBase)
const BASE_TO_CATEGORY: Record<string, string> = {
  sportsBase: "SPORTS",
  combatBase: "COMBAT",
  esportsBase: "ESPORTS",
  boardBase: "BOARD_GAMES",
};

const OUTCOME_TYPE_MAP: Record<string, string> = {
  WIN_LOSE: "WINNER",
  WIN_LOSE_DRAW: "WINNER",
  PLACEMENT: "WINNER",
};

export type ParsedTemplate = z.infer<typeof CreateBetTemplateInputSchema>;

/**
 * Parse Wager templates file and extract our 15 target templates.
 * Returns array of Zentrix-shaped templates ready for DB upsert.
 */
export function parseTemplates(): ParsedTemplate[] {
  const content = readFileSync(WAGER_SOURCE, "utf-8");
  const results: ParsedTemplate[] = [];

  for (const slug of TARGET_SLUGS) {
    // Find line containing this slug
    const slugPattern = `slug: "${slug}"`;
    const lineMatch = content
      .split("\n")
      .find((l) => l.includes(slugPattern));

    if (!lineMatch) {
      throw new Error(`P21 parser: slug "${slug}" not found in Wager source`);
    }

    const baseMatch = lineMatch.match(/\.\.\.(\w+)Base/);
    const wagerCategory = baseMatch ? BASE_TO_CATEGORY[`${baseMatch[1]}Base`] : null;
    if (!wagerCategory) {
      throw new Error(`P21 parser: no base category found for slug "${slug}"`);
    }

    const nameMatch = lineMatch.match(/name: "([^"]+)"/);
    const outcomeMatch = lineMatch.match(/outcomeType: "(\w+)"/);
    const resolutionMatch = lineMatch.match(/resolutionRule: "([^"]+)"/);

    if (!nameMatch || !outcomeMatch || !resolutionMatch) {
      throw new Error(`P21 parser: incomplete data for slug "${slug}"`);
    }

    const wagerOutcomeType = outcomeMatch[1];
    const mappedOutcomeType = OUTCOME_TYPE_MAP[wagerOutcomeType];
    if (!mappedOutcomeType) {
      throw new Error(`P21 parser: cannot map outcomeType "${wagerOutcomeType}" for slug "${slug}"`);
    }

    results.push({
      slug,
      name: nameMatch[1],
      category: CATEGORY_MAP[wagerCategory],
      description: undefined,
      settlementType: "BINARY",
      outcomeType: mappedOutcomeType,
      fieldsSchema: {
        type: "object",
        properties: {
          eventDate: { type: "string", description: "Event date" },
        },
        required: ["eventDate"],
        additionalProperties: true,
      },
      allowedSources: [
        {
          providerId: "official-api",
          name: "Official API",
          type: "OFFICIAL_API",
        },
      ],
      resolutionRule: resolutionMatch[1],
      supportsAutoResolve: false,
      requiresOfficialEvent: true,
    });
  }

  return results;
}
