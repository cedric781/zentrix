/**
 * Template endpoint wrappers — thin layer over apiFetch.
 *
 * Backed by:
 *   GET /api/templates           (list, optional category/settlementMethod filter)
 *   GET /api/templates/[slug]    (detail)
 *
 * Both endpoints require auth (requireCurrentUser). Soft-deleted templates
 * are filtered server-side (deletedAt = null).
 */

import { apiFetch } from "./client";
import type { BetTemplateSerialized } from "./types";

export type SettlementMethod =
  | "OFFICIAL_RESULT"
  | "ORACLE_VALUE"
  | "PLATFORM_PROOF"
  | "THRESHOLD_METRIC";

export type TemplatesFilter = {
  category?: string;
  settlementMethod?: SettlementMethod;
};

export type TemplatesListResponse = {
  templates: BetTemplateSerialized[];
  total: number;
};

export type TemplateDetailResponse = {
  template: BetTemplateSerialized;
};

function buildQuery(params: Record<string, string | undefined>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      entries.push([k, v]);
    }
  }
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

export async function listTemplates(
  filter: TemplatesFilter = {},
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<TemplatesListResponse> {
  const qs = buildQuery({
    category: filter.category,
    settlementMethod: filter.settlementMethod,
  });
  return apiFetch<TemplatesListResponse>(`/api/templates${qs}`, {
    method: "GET",
    token: options.token,
    signal: options.signal,
  });
}

export async function getTemplate(
  slug: string,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<TemplateDetailResponse> {
  return apiFetch<TemplateDetailResponse>(
    `/api/templates/${encodeURIComponent(slug)}`,
    {
      method: "GET",
      token: options.token,
      signal: options.signal,
    },
  );
}
