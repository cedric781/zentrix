import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { bigToStr } from "@/lib/http/bigint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const fa = await prisma.financialAccount.findUnique({
      where: { userId: user.id },
    });
    if (!fa) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      data: {
        id: fa.id,
        accountType: fa.accountType,
        balanceUnits: bigToStr(fa.balanceUnits),
        updatedAt: fa.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
