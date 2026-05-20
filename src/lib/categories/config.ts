import { Trophy, Swords, Gamepad2, Dices, type LucideIcon } from "lucide-react";

export type CategorySlug = "sport" | "combat" | "esports" | "games";

export type CategoryEntry = {
  /** Database value — EXACT match required for filtering */
  dbValue: string;
  /** URL slug (lowercase) */
  slug: CategorySlug;
  /** Display label */
  label: string;
  /** Plural form for "X bets in this category" */
  plural: string;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Short marketing description */
  description: string;
};

export const CATEGORY_CONFIG: Record<CategorySlug, CategoryEntry> = {
  sport: {
    dbValue: "Sport",
    slug: "sport",
    label: "Sport",
    plural: "Sports",
    icon: Trophy,
    description: "Football, basketball, tennis and more.",
  },
  combat: {
    dbValue: "Combat",
    slug: "combat",
    label: "Combat",
    plural: "Combat sports",
    icon: Swords,
    description: "Boxing, MMA, kickboxing.",
  },
  esports: {
    dbValue: "Esports",
    slug: "esports",
    label: "Esports",
    plural: "Esports",
    icon: Gamepad2,
    description: "League of Legends, Dota 2, CS, Valorant.",
  },
  games: {
    dbValue: "Games",
    slug: "games",
    label: "Games",
    plural: "Games",
    icon: Dices,
    description: "Chess, poker, board games.",
  },
};

/** Visible in UI in this order */
export const VISIBLE_CATEGORIES: CategorySlug[] = [
  "sport",
  "combat",
  "esports",
  "games",
];

/** Get config by URL slug */
export function getCategoryBySlug(slug: string): CategoryEntry | null {
  if (slug in CATEGORY_CONFIG) {
    return CATEGORY_CONFIG[slug as CategorySlug];
  }
  return null;
}

/** Get config by DB value (case-sensitive exact match) */
export function getCategoryByDbValue(dbValue: string): CategoryEntry | null {
  const entry = Object.values(CATEGORY_CONFIG).find(
    (c) => c.dbValue === dbValue,
  );
  return entry ?? null;
}

/** All DB values for quick filtering */
export const ALL_DB_VALUES = Object.values(CATEGORY_CONFIG).map(
  (c) => c.dbValue,
);
