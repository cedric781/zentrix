import { describe, test, expect } from "vitest";
import { CreateBetBody } from "@/lib/bets/create-bet-schema";

// Zod-layer test for the settlement-mode invariant. Pure schema parse — no DB,
// no side-effects. The zod schema only enforces the externalRef invariant;
// template capability (supportsAutoResolve) + templateId-presence are SERVICE
// concerns, so #5/#6 intentionally PASS here and are caught by the service
// guard (see scripts-local/synthetic_bet.mts invariant-test mode).

const baseBody = {
  side: "A",
  stakeUnits: "1000000",
  expiresInHours: 24,
  title: "Invariant test",
  outcomeA: "A wins",
  outcomeB: "B wins",
};

const validExternalRef = {
  provider: "espn",
  eventId: "401",
  league: "NBA",
  sport: "basketball",
  eventStartsAt: "2026-07-01T18:00:00.000Z",
  eventEndsAt: "2026-07-01T21:00:00.000Z",
};

const hasExternalRefIssue = (
  r: ReturnType<typeof CreateBetBody.safeParse>,
): boolean =>
  !r.success && r.error.issues.some((i) => i.path.join(".") === "externalRef");

describe("CreateBetBody — settlement-mode invariant (zod layer)", () => {
  test("#1 PEER_AGREE default + no externalRef → pass, defaults to PEER_AGREE", () => {
    const r = CreateBetBody.safeParse({ ...baseBody });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.settlementMode).toBe("PEER_AGREE");
  });

  test("#2 PEER_AGREE + externalRef → fail (externalRef path)", () => {
    const r = CreateBetBody.safeParse({
      ...baseBody,
      settlementMode: "PEER_AGREE",
      externalRef: validExternalRef,
    });
    expect(r.success).toBe(false);
    expect(hasExternalRefIssue(r)).toBe(true);
  });

  test("#3 AUTO_VERIFY + externalRef → pass", () => {
    const r = CreateBetBody.safeParse({
      ...baseBody,
      settlementMode: "AUTO_VERIFY",
      externalRef: validExternalRef,
    });
    expect(r.success).toBe(true);
  });

  test("#4 AUTO_VERIFY + no externalRef → fail (externalRef path)", () => {
    const r = CreateBetBody.safeParse({
      ...baseBody,
      settlementMode: "AUTO_VERIFY",
    });
    expect(r.success).toBe(false);
    expect(hasExternalRefIssue(r)).toBe(true);
  });

  // Boundary documentation: zod does NOT know template capability.
  test("#5 AUTO_VERIFY + externalRef + non-capable templateId → PASS at zod (service guard catches)", () => {
    const r = CreateBetBody.safeParse({
      ...baseBody,
      settlementMode: "AUTO_VERIFY",
      externalRef: validExternalRef,
      templateId: "391747cb-de69-4a84-b9a2-d03db4cebb58", // chess-match-winner, supportsAutoResolve=false
    });
    expect(r.success).toBe(true);
  });

  test("#6 AUTO_VERIFY + externalRef + no templateId → PASS at zod (service guard catches)", () => {
    const r = CreateBetBody.safeParse({
      ...baseBody,
      settlementMode: "AUTO_VERIFY",
      externalRef: validExternalRef,
    });
    expect(r.success).toBe(true);
  });
});
