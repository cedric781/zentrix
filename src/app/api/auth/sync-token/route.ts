import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getPrivyServerClient } from "@/lib/privy/server";
import { logger } from "@/lib/logger";

const Body = z.object({ accessToken: z.string().min(20) });

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const privy = getPrivyServerClient();
  try {
    await privy.verifyAuthToken(body.data.accessToken);
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set("privy-token", body.data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  logger.info("privy token synced to cookie");
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete("privy-token");
  return NextResponse.json({ ok: true });
}