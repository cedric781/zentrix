import "server-only";
import { headers } from "next/headers";

/**
 * Thrown by requireAdmin() when the request is missing a valid admin token.
 * Routes catch this and return 401.
 */
export class AdminAuthError extends Error {
  constructor(message: string = "Admin token invalid or missing") {
    super(message);
    this.name = "AdminAuthError";
  }
}

/**
 * Guard for /api/admin/* routes. NO Privy session — admin tooling is
 * out-of-band, the token is set in Vercel env and rotated manually.
 *
 * Convention: `Authorization: Bearer <ADMIN_API_TOKEN>` (matches the cron
 * route pattern in poll-deposits/route.ts). Reads `process.env` directly
 * rather than going through getEnv() so that startup-time schema parsing
 * does not need a token to be set during build/CI.
 *
 * If `ADMIN_API_TOKEN` is not set in env, this ALWAYS throws — there is no
 * open-dev mode. Set the var locally if you need to hit admin routes from
 * a dev shell.
 */
export async function requireAdmin(): Promise<void> {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    throw new AdminAuthError("ADMIN_API_TOKEN not configured");
  }
  const auth = (await headers()).get("authorization");
  if (auth !== `Bearer ${expected}`) {
    throw new AdminAuthError();
  }
}
