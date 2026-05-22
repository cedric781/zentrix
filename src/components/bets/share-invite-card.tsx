"use client";

import { useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  betId: string;
  inviteUrl: string;
  expiresAt: Date;
  onRegenerated?: (next: { inviteUrl: string; expiresAt: Date }) => void;
}

export function ShareInviteCard({
  betId,
  inviteUrl: initialUrl,
  expiresAt: initialExpiresAt,
  onRegenerated,
}: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link gekopieerd");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kon link niet kopiëren");
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(
        `/api/bets/${encodeURIComponent(betId)}/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: "{}",
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        inviteUrl: string;
        expiresAt: string;
      };
      const nextExpiresAt = new Date(data.expiresAt);
      setUrl(data.inviteUrl);
      setExpiresAt(nextExpiresAt);
      onRegenerated?.({ inviteUrl: data.inviteUrl, expiresAt: nextExpiresAt });
      toast.success("Nieuwe invite-link gegenereerd");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Genereren mislukt");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">Deel deze bet</h3>
        <p className="text-xs text-muted-foreground">
          {formatTimeUntil(expiresAt)}
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          className="shrink-0"
          aria-label="Kopieer link"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleRegenerate}
        disabled={regenerating}
      >
        {regenerating ? (
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-3 w-3" />
        )}
        Nieuwe link genereren
      </Button>
    </div>
  );
}

function formatTimeUntil(date: Date): string {
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "Verlopen";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `Verloopt over ${days} ${days === 1 ? "dag" : "dagen"}`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `Verloopt over ${hours} uur`;
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `Verloopt over ${minutes} min`;
}
