"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { usePublishPool } from "@/hooks/use-publish-pool";

export function PublishPoolButton({
  poolId,
  hasMatches,
}: {
  poolId: string;
  hasMatches: boolean;
}) {
  const { mutate, isPending } = usePublishPool(poolId);

  const handleClick = () => {
    mutate(undefined, {
      onSuccess: () => toast.success("Pool published"),
      onError: (err) => {
        if (err instanceof ApiError) {
          toast.error(err.message);
          return;
        }
        toast.error("Failed to publish pool");
      },
    });
  };

  return (
    <div className="space-y-2 pt-4 border-t">
      <h3 className="text-sm font-semibold">Publish</h3>
      <p className="text-xs text-muted-foreground">
        Publishing transitions the pool from DRAFT to OPEN so bettors can place
        bets.
      </p>
      <Button type="button" onClick={handleClick} disabled={isPending}>
        {isPending ? "Publishing…" : "Publish pool"}
      </Button>
      {!hasMatches && (
        <p className="text-xs text-yellow-600 dark:text-yellow-500">
          Add at least one match before publishing.
        </p>
      )}
    </div>
  );
}
