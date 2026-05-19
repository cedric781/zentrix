import { apiFetch } from "./client";
import type { DepositSerialized, Paginated } from "./types";

export type DepositStatusFilter = "PENDING" | "CREDITED" | "FAILED";

export type ListDepositsParams = {
  cursor?: string;
  /** Page size; backend caps via parseListQuery. */
  take?: number;
  status?: DepositStatusFilter;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      entries.push([k, String(v)]);
    }
  }
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

export async function listDeposits(
  params: ListDepositsParams = {},
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<Paginated<DepositSerialized>> {
  const qs = buildQuery({
    cursor: params.cursor,
    take: params.take,
    status: params.status,
  });
  return apiFetch<Paginated<DepositSerialized>>(`/api/deposits${qs}`, {
    method: "GET",
    token: options.token,
    signal: options.signal,
  });
}
