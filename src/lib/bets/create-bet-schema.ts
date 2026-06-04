/**
 * Create-bet request schema + settlement-mode invariant.
 *
 * Extracted from the API route so the UI (create-bet wizard) can reuse the
 * exact same client-side validation. Intentionally free of server-only deps
 * (zod only) — safe to import from client components.
 *
 * The bidirectional invariant (AUTO_VERIFY ⟺ externalRef) is also mirrored in
 * the service domain guard (`createBet`) — the HTTP edge is never the sole
 * line of defence.
 */
import { z } from "zod";

export const CreateBetBody = z
  .object({
    side: z.enum(["A", "B"]),
    stakeUnits: z.string().regex(/^\d+$/, "stakeUnits must be a decimal string"),
    expiresInHours: z.number().int().min(1).max(168),
    poolId: z.string().min(1).optional(),
    matchId: z.string().min(1).optional(),
    title: z.string().min(1).max(200),
    outcomeA: z.string().min(1).max(100),
    outcomeB: z.string().min(1).max(100),
    externalRef: z
      .object({
        provider: z.enum(["espn", "thesportsdb"]),
        eventId: z.string().min(1).max(200),
        league: z.string().min(1).max(100),
        sport: z.enum([
          "football",
          "basketball",
          "american_football",
          "ice_hockey",
          "baseball",
          "tennis",
          "mma",
        ]),
        eventStartsAt: z.string().datetime(),
        eventEndsAt: z.string().datetime(),
      })
      .optional(),
    templateId: z.string().uuid().optional(),
    category: z.string().min(1).max(50).optional(),
    isCustom: z.boolean().optional(),
    settlementMode: z.enum(["PEER_AGREE", "AUTO_VERIFY"]).default("PEER_AGREE"),
  })
  .superRefine((data, ctx) => {
    // Bidirectional invariant: AUTO_VERIFY ⟺ externalRef. Mirrored in the
    // service domain guard (createBet); enforced here for a clean 400 bad_body.
    if (data.settlementMode === "AUTO_VERIFY" && !data.externalRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["externalRef"],
        message:
          "AUTO_VERIFY requires externalRef (an external event to auto-resolve against)",
      });
    }
    if (data.settlementMode === "PEER_AGREE" && data.externalRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["externalRef"],
        message:
          "PEER_AGREE must not have externalRef (peer-confirmed bets are not auto-resolved)",
      });
    }
  });

export type CreateBetBodyInput = z.infer<typeof CreateBetBody>;
