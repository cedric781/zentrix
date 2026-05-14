import { prisma } from "@/lib/prisma";
import type { BetTemplate, SettlementMethod } from "@prisma/client";

export interface ListTemplatesFilter {
  category?: string;
  settlementMethod?: SettlementMethod;
  activeOnly?: boolean;
}

export async function listTemplates(
  filter: ListTemplatesFilter = {},
): Promise<BetTemplate[]> {
  const where: {
    category?: string;
    settlementMethod?: SettlementMethod;
    isActive?: boolean;
    deletedAt?: null;
  } = {};
  if (filter.category) where.category = filter.category;
  if (filter.settlementMethod) where.settlementMethod = filter.settlementMethod;
  if (filter.activeOnly !== false) {
    where.isActive = true;
    where.deletedAt = null;
  }

  return prisma.betTemplate.findMany({
    where,
    orderBy: { name: "asc" },
  });
}

export async function getTemplate(slug: string): Promise<BetTemplate | null> {
  return prisma.betTemplate.findFirst({
    where: { slug, deletedAt: null },
  });
}
