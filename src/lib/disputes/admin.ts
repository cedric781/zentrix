import "server-only";
import { env } from "@/lib/env";

export function isAdmin(userId: string): boolean {
  const raw = env().ADMIN_USER_IDS;
  if (!raw) return false;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.includes(userId);
}
