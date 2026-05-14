"use client";

/**
 * useTemplates — React Query hook for /api/templates.
 *
 * Auto-disabled when Privy session isn't ready or user not authenticated.
 * Backend returns { templates: BetTemplateSerialized[], total: number }.
 *
 * staleTime 5min: templates are seeded data, rarely change.
 */

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { listTemplates, type TemplatesFilter } from "@/lib/api/templates";

export function useTemplates(filter?: TemplatesFilter) {
  const { ready, authenticated } = usePrivy();

  return useQuery({
    queryKey: ["templates", filter],
    queryFn: ({ signal }) => listTemplates(filter, { signal }),
    enabled: ready && authenticated,
    staleTime: 5 * 60_000,
  });
}
