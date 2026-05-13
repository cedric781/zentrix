/**
 * Current user wrappers. /api/me returns serializeUser shape.
 */

import { apiFetch } from "./client";
import type { UserSerialized } from "./types";

export async function getMe(
  options: { signal?: AbortSignal } = {},
): Promise<UserSerialized> {
  return apiFetch<UserSerialized>("/api/me", {
    method: "GET",
    signal: options.signal,
  });
}
