import "server-only";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fire-and-forget diagnostic sink for the client-side wallet-delegation hook.
// No auth: low-value diagnostic data, must never block UI on failure. Volume
// is tiny (1-3 events per authorize attempt). We log server-side so the same
// events that exist in the browser console also exist in centralised logs.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    logger.info({ forensic: body }, "[WITHDRAW_AUTH_FORENSIC]");
  } catch {
    // tolerate missing/invalid body
  }
  return NextResponse.json({ ok: true });
}
