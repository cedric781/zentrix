"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCreateBetState } from "./create-bet-context";
import { useCreateBet } from "@/hooks/use-create-bet";
import { ApiError } from "@/lib/api/client";

export function SubmitBetButton() {
  const router = useRouter();
  const state = useCreateBetState();
  const { mutate, isPending } = useCreateBet();

  const isComplete = Boolean(
    state.template &&
      state.title &&
      state.outcomeA &&
      state.outcomeB &&
      state.stakeUnits,
  );

  const stakeNum = Number(state.stakeUnits);
  const isValidStake = Number.isFinite(stakeNum) && stakeNum >= 1;
  const canSubmit = isComplete && isValidStake && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;

    // Convert human USDC to integer micro-units (×1,000,000) as decimal string.
    // Server regex /^\d+$/ rejects fractions, so we must produce a whole-integer string.
    const stakeMicroUnits = String(
      BigInt(Math.round(stakeNum * 1_000_000)),
    );

    mutate(
      {
        title: state.title,
        outcomeA: state.outcomeA,
        outcomeB: state.outcomeB,
        side: state.side,
        stakeUnits: stakeMicroUnits,
        expiresInHours: state.expiresInHours,
        externalRef: state.externalRef ?? undefined,
      },
      {
        onSuccess: (data) => {
          toast.success("Bet created");
          state.reset();
          router.push(`/bets/${data.bet.id}`);
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
  );
}
