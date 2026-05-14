import { describe, it, expect, vi } from "vitest";
import { parseTemplates, TARGET_SLUGS, CATEGORY_MAP } from "@/scripts/lib/wager-template-parser";

describe("P21 template seeder", () => {
  it("TARGET_SLUGS has exactly 15 entries", () => {
    expect(TARGET_SLUGS).toHaveLength(15);
  });

  it("parseTemplates returns 15 templates", () => {
    const templates = parseTemplates();
    expect(templates).toHaveLength(15);
  });

  it("all templates have settlementType BINARY", () => {
    const templates = parseTemplates();
    for (const t of templates) {
      expect(t.settlementType).toBe("BINARY");
    }
  });

  it("all templates map outcomeType to WINNER", () => {
    const templates = parseTemplates();
    for (const t of templates) {
      expect(t.outcomeType).toBe("WINNER");
    }
  });

  it("category mapping converts SCREAMING to Title case", () => {
    expect(CATEGORY_MAP.SPORTS).toBe("Sport");
    expect(CATEGORY_MAP.COMBAT).toBe("Combat");
    expect(CATEGORY_MAP.ESPORTS).toBe("Esports");
    expect(CATEGORY_MAP.BOARD_GAMES).toBe("Games");
  });
});
