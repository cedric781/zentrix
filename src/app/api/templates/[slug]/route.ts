import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { getTemplate } from "@/lib/templates/service";
import { mapDomainError } from "@/lib/http/errors";
import { serializeTemplate } from "@/lib/http/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await requireCurrentUser();

    const { slug } = await params;
    const template = await getTemplate(slug);

    if (!template) {
      return NextResponse.json(
        { error: "template_not_found", slug },
        { status: 404 },
      );
    }

    return NextResponse.json({ template: serializeTemplate(template) });
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
