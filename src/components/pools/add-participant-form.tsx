"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { useAddParticipant } from "@/hooks/use-add-participant";

const NAME_MAX = 100;

export function AddParticipantForm({
  poolId,
  disabled,
}: {
  poolId: string;
  disabled?: boolean;
}) {
  const [displayName, setDisplayName] = useState("");
  const { mutate, isPending } = useAddParticipant(poolId);

  const nameTrim = displayName.trim();
  const isValid = nameTrim.length >= 1 && nameTrim.length <= NAME_MAX;
  const canSubmit = isValid && !isPending && !disabled;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutate(
      { displayName: nameTrim },
      {
        onSuccess: () => {
          toast.success("Participant added");
          setDisplayName("");
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            toast.error(err.message);
            return;
          }
          toast.error("Failed to add participant");
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Add participant</h3>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor="participant-name">Name</Label>
          <Input
            id="participant-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={NAME_MAX}
            placeholder="e.g. Fighter A"
            disabled={isPending || disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
        </div>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="sm"
        >
          {isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}
