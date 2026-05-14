import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { listTemplates } from "@/lib/templates/service";
import { mapDomainError } from "@/lib/http/errors";
import { serializeTemplate } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  category: z.string().min(1).optional(),
  settlementMethod: z
    .enum(["OFFICIAL_RESULT", "ORACLE_VALUE", "PLATFORM_PROOF", "THRESHOLD_METRIC"])
    .optional(),
  activeOnly: z.coerce.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    await requireCurrentUser();

    const url = new URL(req.url);
    const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const templates = await listTemplates(parsed.data);
    return NextResponse.json({
      templates: templates.map(serializeTemplate),
      total: templates.length,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
