import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { serializeUser } from "@/lib/http/serialize";
import { mapDomainError } from "@/lib/http/errors";

/**
 * GET /api/me — returns current authenticated user.
 *
 * Used by frontend useCurrentUser() hook to resolve the Privy DID to the
 * internal User row (id, email, embeddedWalletAddress).
 *
 * Requires valid privy-token cookie. Returns 401 otherwise.
 */
export async function GET() {
  try {
    const user = await requireCurrentUser();
    return NextResponse.json(serializeUser(user));
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
