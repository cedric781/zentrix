import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { mapDomainError } from "@/lib/http/errors";
import { SUPPORTED_SPORTS } from "@/lib/api/types";
import { EspnProvider } from "@/lib/external-results/providers/espn";
import { TheSportsDbProvider } from "@/lib/external-results/providers/thesportsdb";
import type { ExternalEventSummary } from "@/lib/external-results/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SportEnum = z.enum(SUPPORTED_SPORTS);
const ProviderEnum = z.enum(["espn", "thesportsdb"]);

const QuerySchema = z.object({
  query: z.string().min(2).max(100),
  sport: SportEnum,
  league: z.string().min(1).max(80).optional(),
  provider: ProviderEnum.optional(),
});

// Singletons — providers are stateless apart from HTTP, no DB.
const espn = new EspnProvider();
const tsdb = new TheSportsDbProvider();

// TODO(P41): rate limiting per user (currently relies on Privy auth gate only).
export async function GET(req: Request) {
  try {
    await requireCurrentUser();

    const url = new URL(req.url);
    const raw = {
      query: url.searchParams.get("query") ?? "",
      sport: url.searchParams.get("sport") ?? undefined,
      league: url.searchParams.get("league") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
    };

    const parsed = QuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "bad_query", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { query, sport, league, provider } = parsed.data;

    // Provider preference: explicit override > ESPN first > TheSportsDB.
    // ESPN has structured league coverage; TheSportsDB has team search but
    // sparser data.
    let events: ExternalEventSummary[] = [];
    if (provider === "espn") {
      events = await espn.searchEvents({ query, sport, league });
    } else if (provider === "thesportsdb") {
      events = await tsdb.searchEvents({ query, sport, league });
    } else {
      events = await espn.searchEvents({ query, sport, league });
      if (events.length === 0) {
        events = await tsdb.searchEvents({ query, sport, league });
      }
    }

    return NextResponse.json(
      { events },
      {
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      },
    );
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
