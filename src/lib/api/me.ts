/**
 * Current user wrappers. /api/me returns serializeUser shape.
 */

import { apiFetch } from "./client";
import type { UserSerialized, FinancialAccountSerialized } from "./types";

export async function getMe(
  options: { signal?: AbortSignal } = {},
): Promise<UserSerialized> {
  return apiFetch<UserSerialized>("/api/me", {
    method: "GET",
    signal: options.signal,
  });
}

export async function getMyBalance(
  options: { signal?: AbortSignal } = {},
): Promise<FinancialAccountSerialized> {
  const res = await apiFetch<{ data: FinancialAccountSerialized }>(
    "/api/me/balance",
    { method: "GET", signal: options.signal },
  );
  return res.data;
}
