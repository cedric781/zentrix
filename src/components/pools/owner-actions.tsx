"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AddMatchForm } from "./add-match-form";
import { PublishPoolButton } from "./publish-pool-button";
import type { PoolStatus, PoolWithMatchesSerialized } from "@/lib/api/pools";

export function OwnerActions({
  pool,
}: {
  pool: PoolWithMatchesSerialized;
}) {
  const { data: me } = useCurrentUser();
  if (!me || me.id !== pool.createdById) return null;

  const status = pool.status as PoolStatus;
  const canAddMatch = status === "DRAFT" || status === "OPEN";
  const canPublish = status === "DRAFT";

  if (!canAddMatch && !canPublish) return null;

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Creator actions
        </h2>
        {canAddMatch && <AddMatchForm poolId={pool.id} />}
        {canPublish && (
          <PublishPoolButton
            poolId={pool.id}
            hasMatches={pool.matches.length > 0}
          />
        )}
      </CardContent>
    </Card>
  );
}
