"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { useLockBracket } from "@/hooks/use-lock-bracket";

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function LockBracketButton({
  poolId,
  format,
  participantCount,
}: {
  poolId: string;
  format: "SINGLE_ELIM" | "DOUBLE_ELIM";
  participantCount: number;
}) {
  const { mutate, isPending } = useLockBracket(poolId);

  let validationError: string | null = null;
  if (format === "SINGLE_ELIM" && participantCount < 2) {
    validationError = "Need at least 2 participants for single elimination.";
  } else if (format === "DOUBLE_ELIM") {
    if (participantCount < 2) {
      validationError = "Need at least 2 participants for double elimination.";
    } else if (!isPowerOfTwo(participantCount)) {
      validationError = `Double elimination needs 2, 4, 8, 16, 32, or 64 participants (got ${participantCount}).`;
    }
  }

  const canLock = validationError === null && !isPending;

  const handleClick = () => {
    if (!canLock) return;
    mutate(
      { format },
      {
        onSuccess: (res) => {
          toast.success(
            `Bracket locked! ${res.data.matchCount} matches generated.`,
          );
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            toast.error(err.message);
            return;
          }
          toast.error("Failed to lock bracket");
        },
      },
    );
  };

  return (
    <div className="space-y-2 pt-4 border-t">
      <h3 className="text-sm font-semibold">Lock bracket</h3>
      <p className="text-xs text-muted-foreground">
        After locking you cannot add or remove participants. Matches will be
        generated automatically based on seeding order.
      </p>
      {validationError && (
        <p className="text-xs text-yellow-600 dark:text-yellow-500">
          {validationError}
        </p>
      )}
      <Button
        type="button"
        onClick={handleClick}
        disabled={!canLock}
      >
        {isPending
          ? "Locking…"
          : `Lock bracket & generate matches`}
      </Button>
    </div>
  );
}
