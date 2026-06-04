"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCreateBetState } from "./create-bet-context";
import { useCreateBet } from "@/hooks/use-create-bet";
import { ApiError } from "@/lib/api/client";
import { CreateBetBody } from "@/lib/bets/create-bet-schema";

// Client-side minimum stake for faster feedback only. The SERVER is the
// authority (env BET_MIN_USDC_UNITS, default 1_000_000); this mirrors that
// default so a sub-minimum stake is flagged before the round-trip.
const MIN_STAKE_MICRO_UNITS = 1_000_000; // 1.0 USDC

export function SubmitBetButton() {
  const router = useRouter();
  const state = useCreateBetState();
  const { mutate, isPending } = useCreateBet();

  // Convert human USDC to integer micro-units (×1,000,000) as decimal string.
  // Server regex /^\d+$/ rejects fractions. Invalid/empty input → "" so the
  // schema fails cleanly (button disabled) instead of BigInt() throwing.
  const stakeNum = Number(state.stakeUnits);
  const stakeMicroUnits =
    Number.isFinite(stakeNum) && stakeNum > 0
      ? String(BigInt(Math.round(stakeNum * 1_000_000)))
      : "";

  // Belt-and-suspenders: strip externalRef whenever the mode is PEER_AGREE, so
  // the payload can never be PEER_AGREE + externalRef even if state desyncs.
  const payload = {
    side: state.side,
    stakeUnits: stakeMicroUnits,
    expiresInHours: state.expiresInHours,
    title: state.title,
    outcomeA: state.outcomeA,
    outcomeB: state.outcomeB,
    externalRef:
      state.settlementMode === "AUTO_VERIFY"
        ? state.externalRef ?? undefined
        : undefined,
    templateId: state.template?.id,
    category: state.template?.category,
    isCustom: false,
    settlementMode: state.settlementMode,
  };

  // Single source of truth for shape + invariant: the exact same zod schema the
  // server uses. Min-stake is an extra client UX layer on top (see below).
  const parsed = CreateBetBody.safeParse(payload);
  const meetsMinStake =
    stakeMicroUnits !== "" &&
    Number(stakeMicroUnits) >= MIN_STAKE_MICRO_UNITS;
  const canSubmit = parsed.success && meetsMinStake && !isPending;
  // Hint priority: AUTO_VERIFY-without-event → below-min stake → generic.
  const missingEvent =
    state.settlementMode === "AUTO_VERIFY" && !state.externalRef;
  const belowMin = parsed.success && !meetsMinStake;

  const handleSubmit = () => {
    if (!canSubmit) return;

    mutate(
      payload,
      {
        onSuccess: (data) => {
          toast.success("Bet created");
          state.reset();
          if (data.inviteToken) {
            state.setCreated({
              betId: data.bet.id,
              inviteToken: data.inviteToken,
              expiresAt: new Date(data.bet.expiresAt),
            });
          } else {
            // Idempotency replay: token isn't persisted, just navigate.
            router.push(`/bets/${data.bet.id}`);
          }
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.httpStatus === 401) {
              toast.error("Please sign in.");
              router.push("/signin");
              return;
            }
            if (err.code === "bad_body") {
              toast.error("Invalid input. Check your form fields.");
              return;
            }
            toast.error(err.message);
            return;
          }
          toast.error("Failed to create bet. Please try again.");
        },
      },
    );
  };

  return (
    <div className="space-y-2">
      {!canSubmit && !isPending && (
        <p className="text-xs text-muted-foreground text-right">
          {missingEvent
            ? "Koppel een wedstrijd/bron, of schakel naar “jullie beslissen zelf”."
            : belowMin
              ? "Minimaal 1 USDC inzet."
              : "Vul de verplichte velden in."}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => state.reset()}
          disabled={isPending}
        >
          Reset
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="lg"
        >
          {isPending ? "Creating..." : "Create Bet"}
        </Button>
      </div>
    </div>
  );
}
