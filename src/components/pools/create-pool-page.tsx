"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api/client";
import { useCreatePool } from "@/hooks/use-create-pool";

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const MIN_HOURS_AHEAD = 1;
const MAX_DAYS_AHEAD = 90;

function defaultClosesAt(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreatePoolPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAtLocal, setClosesAtLocal] = useState<string>(defaultClosesAt);
  const { mutate, isPending } = useCreatePool();

  const titleTrim = title.trim();
  const descTrim = description.trim();
  const isValidTitle = titleTrim.length >= 1 && titleTrim.length <= TITLE_MAX;
  const isValidDesc = descTrim.length <= DESC_MAX;

  let closesAtIso: string | null = null;
  let isValidDate = false;
  if (closesAtLocal) {
    const d = new Date(closesAtLocal);
    if (!Number.isNaN(d.getTime())) {
      const msAhead = d.getTime() - Date.now();
      const minMs = MIN_HOURS_AHEAD * 60 * 60 * 1000;
      const maxMs = MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
      if (msAhead >= minMs && msAhead <= maxMs) {
        closesAtIso = d.toISOString();
        isValidDate = true;
      }
    }
  }

  const canSubmit = isValidTitle && isValidDesc && isValidDate && !isPending;

  const handleSubmit = () => {
    if (!canSubmit || !closesAtIso) return;
    mutate(
      {
        title: titleTrim,
        description: descTrim || undefined,
        bettingClosesAt: closesAtIso,
      },
      {
        onSuccess: (res) => {
          toast.success("Pool created");
          router.push(`/pools/${res.data.id}`);
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
          toast.error("Failed to create pool. Please try again.");
        },
      },
    );
  };

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-2xl px-4">
      <header>
        <h1 className="text-3xl font-bold">Create a pool</h1>
        <p className="text-muted-foreground">
          Pools bundle multiple matches that bettors can stake against.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pool-title">Title</Label>
            <Input
              id="pool-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              placeholder="e.g. Spring 2026 NBA playoffs"
            />
            <p className="text-xs text-muted-foreground">
              {titleTrim.length}/{TITLE_MAX}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pool-description">Description (optional)</Label>
            <Textarea
              id="pool-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESC_MAX}
              rows={4}
              placeholder="What is this pool about?"
            />
            <p className="text-xs text-muted-foreground">
              {descTrim.length}/{DESC_MAX}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pool-closes-at">Betting closes at</Label>
            <Input
              id="pool-closes-at"
              type="datetime-local"
              value={closesAtLocal}
              onChange={(e) => setClosesAtLocal(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Must be between 1 hour and 90 days from now.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/pools")}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="lg"
        >
          {isPending ? "Creating…" : "Create pool"}
        </Button>
      </div>
    </div>
  );
}
