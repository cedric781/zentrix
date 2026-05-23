"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useParticipants } from "@/hooks/use-participants";
import { AddMatchForm } from "./add-match-form";
import { AddParticipantForm } from "./add-participant-form";
import { ParticipantList } from "./participant-list";
import { LockBracketButton } from "./lock-bracket-button";
import { PublishPoolButton } from "./publish-pool-button";
import type {
  PoolStatus,
  TournamentFormat,
  PoolWithMatchesSerialized,
} from "@/lib/api/pools";

export function OwnerActions({
  pool,
}: {
  pool: PoolWithMatchesSerialized;
}) {
  const { data: me } = useCurrentUser();
  const participantsQuery = useParticipants(pool.id);

  if (!me || me.id !== pool.createdById) return null;

  const status = pool.status as PoolStatus;
  const format = pool.tournamentFormat as TournamentFormat;
  const isBracket = format !== "SIMPLE";
  const isLocked = pool.bracketLockedAt !== null;

  if (isBracket) {
    return <BracketOwnerActions pool={pool} status={status} format={format} isLocked={isLocked} participantCount={participantsQuery.data?.items.length ?? 0} />;
  }

  return <SimpleOwnerActions pool={pool} status={status} />;
}

function SimpleOwnerActions({
  pool,
  status,
}: {
  pool: PoolWithMatchesSerialized;
  status: PoolStatus;
}) {
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

function BracketOwnerActions({
  pool,
  status,
  format,
  isLocked,
  participantCount,
}: {
  pool: PoolWithMatchesSerialized;
  status: PoolStatus;
  format: "SINGLE_ELIM" | "DOUBLE_ELIM";
  isLocked: boolean;
  participantCount: number;
}) {
  if (status === "DRAFT" && !isLocked) {
    return (
      <Card>
        <CardContent className="p-6 space-y-6">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Tournament setup
          </h2>
          <ParticipantList poolId={pool.id} canDelete />
          <AddParticipantForm
            poolId={pool.id}
            disabled={participantCount >= 64}
          />
          {participantCount >= 64 && (
            <p className="text-xs text-muted-foreground">
              Maximum 64 participants reached.
            </p>
          )}
          <LockBracketButton
            poolId={pool.id}
            format={format}
            participantCount={participantCount}
          />
        </CardContent>
      </Card>
    );
  }

  if (status === "DRAFT" && isLocked) {
    return (
      <Card>
        <CardContent className="p-6 space-y-6">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Tournament setup
          </h2>
          <ParticipantList poolId={pool.id} canDelete={false} />
          <p className="text-xs text-muted-foreground">
            Bracket locked — {pool.matches.length} matches generated. Ready to
            publish.
          </p>
          <PublishPoolButton
            poolId={pool.id}
            hasMatches={pool.matches.length > 0}
          />
        </CardContent>
      </Card>
    );
  }

  if (status === "OPEN" || status === "CLOSED") {
    return (
      <Card>
        <CardContent className="p-6 space-y-6">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Tournament participants
          </h2>
          <ParticipantList poolId={pool.id} canDelete={false} />
        </CardContent>
      </Card>
    );
  }

  return null;
}
