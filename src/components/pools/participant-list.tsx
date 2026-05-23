"use client";

import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/lib/api/client";
import { useParticipants } from "@/hooks/use-participants";
import { useRemoveParticipant } from "@/hooks/use-remove-participant";

export function ParticipantList({
  poolId,
  canDelete,
}: {
  poolId: string;
  canDelete: boolean;
}) {
  const query = useParticipants(poolId);
  const removeMutation = useRemoveParticipant(poolId);

  const handleDelete = (participantId: string, name: string) => {
    removeMutation.mutate(participantId, {
      onSuccess: () => toast.success(`Removed ${name}`),
      onError: (err) => {
        if (err instanceof ApiError) {
          toast.error(err.message);
          return;
        }
        toast.error("Failed to remove participant");
      },
    });
  };

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load participants</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>
            {query.error instanceof Error
              ? query.error.message
              : "Unknown error"}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => query.refetch()}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const items = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-8 text-center">
        <p className="text-sm font-medium">No participants yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Add the first participant to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Participants ({items.length}/64)
      </h3>
      <ul className="space-y-1">
        {items.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm border border-[var(--outline-variant)]/40"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold tabular-nums shrink-0">
              {p.seed}
            </span>
            <span className="flex-1 truncate">{p.displayName}</span>
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(p.id, p.displayName)}
                disabled={removeMutation.isPending}
                aria-label={`Remove ${p.displayName}`}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
