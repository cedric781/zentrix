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
import type { TournamentFormat } from "@/lib/api/pools";

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
  const [tournamentFormat, setTournamentFormat] =
    useState<TournamentFormat>("SIMPLE");
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
        tournamentFormat,
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

          <fieldset className="space-y-3" disabled={isPending}>
            <Label asChild>
              <legend>Format</legend>
            </Label>
            {(
              [
                {
                  value: "SIMPLE",
                  label: "Simple matches",
                  desc: "Multiple independent matches, no advancement tree.",
                },
                {
                  value: "SINGLE_ELIM",
                  label: "Single elimination",
                  desc: "Bracket tournament — loser is out, winner advances. 2-64 participants.",
                },
                {
                  value: "DOUBLE_ELIM",
                  label: "Double elimination",
                  desc: "Bracket with losers bracket — eliminated after 2 losses. Requires 2/4/8/16/32 participants.",
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-3 cursor-pointer rounded-md border p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-[var(--brand)] has-[:checked]:bg-muted/30"
              >
                <input
                  type="radio"
                  name="tournamentFormat"
                  value={opt.value}
                  checked={tournamentFormat === opt.value}
                  onChange={() => setTournamentFormat(opt.value)}
                  className="mt-1 accent-[var(--brand)]"
                />
                <div>
                  <span className="text-sm font-medium">{opt.label}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {opt.desc}
                  </p>
                </div>
              </label>
            ))}
            {tournamentFormat !== "SIMPLE" && (
              <p className="text-xs text-muted-foreground">
                Tournament pools need participants and a locked bracket before
                publishing. You&apos;ll add participants on the next page.
              </p>
            )}
          </fieldset>

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
