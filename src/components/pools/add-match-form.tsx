"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { useAddMatch } from "@/hooks/use-add-match";

const TITLE_MAX = 200;
const DESC_MAX = 2000;

export function AddMatchForm({ poolId }: { poolId: string }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventTimeLocal, setEventTimeLocal] = useState("");
  const { mutate, isPending } = useAddMatch(poolId);

  const titleTrim = title.trim();
  const descTrim = description.trim();
  const isValidTitle = titleTrim.length >= 1 && titleTrim.length <= TITLE_MAX;
  const isValidDesc = descTrim.length <= DESC_MAX;

  let eventTimeIso: string | undefined;
  let isValidEventTime = true;
  if (eventTimeLocal) {
    const d = new Date(eventTimeLocal);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      isValidEventTime = false;
    } else {
      eventTimeIso = d.toISOString();
    }
  }

  const canSubmit =
    isValidTitle && isValidDesc && isValidEventTime && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutate(
      {
        title: titleTrim,
        description: descTrim || undefined,
        eventTime: eventTimeIso,
      },
      {
        onSuccess: () => {
          toast.success("Match added");
          setTitle("");
          setDescription("");
          setEventTimeLocal("");
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            toast.error(err.message);
            return;
          }
          toast.error("Failed to add match");
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Add a match</h3>
      <div className="space-y-2">
        <Label htmlFor="match-title">Title</Label>
        <Input
          id="match-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          placeholder="e.g. Lakers vs Celtics"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="match-description">Description (optional)</Label>
        <Textarea
          id="match-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESC_MAX}
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="match-event-time">Event time (optional)</Label>
        <Input
          id="match-event-time"
          type="datetime-local"
          value={eventTimeLocal}
          onChange={(e) => setEventTimeLocal(e.target.value)}
        />
        {!isValidEventTime && (
          <p className="text-xs text-destructive">
            Event time must be in the future.
          </p>
        )}
      </div>
      <Button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        size="sm"
      >
        {isPending ? "Adding…" : "Add match"}
      </Button>
    </div>
  );
}
