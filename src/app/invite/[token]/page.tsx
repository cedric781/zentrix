import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getInviteByToken } from "@/lib/invites/service";
import { TOKEN_HEX } from "@/lib/invites/token";
import { formatUsdc } from "@/lib/money/units";
import { AcceptInviteButton } from "@/components/bets/accept-invite-button";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!TOKEN_HEX.test(token)) {
    return (
      <InviteMessage
        title="Uitnodiging niet gevonden"
        description="Deze link is ongeldig of niet meer beschikbaar."
      />
    );
  }

  const invite = await getInviteByToken({ tokenPlain: token });
  if (!invite) {
    return (
      <InviteMessage
        title="Uitnodiging niet gevonden"
        description="Deze link is ongeldig of niet meer beschikbaar."
      />
    );
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    return (
      <InviteMessage
        title="Deze uitnodiging is verlopen"
        description="De creator kan een nieuwe link genereren."
      />
    );
  }

  if (invite.usedAt !== null) {
    return (
      <InviteMessage
        title="Bet al geaccepteerd"
        description="Deze bet is al door iemand anders geaccepteerd."
      />
    );
  }

  const { bet } = invite;
  const opponentSide = bet.creatorSide === "A" ? "B" : "A";
  const opponentOutcome =
    bet.creatorSide === "A" ? bet.outcomeB : bet.outcomeA;
  const stakeLabel = `${formatUsdc(bet.stakeUnits)} USDC`;

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {bet.title || "Bet uitnodiging"}
          </CardTitle>
          <CardDescription>
            Je bent uitgenodigd om deze bet aan te gaan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Inzet</div>
              <div className="font-mono font-medium">{stakeLabel}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Jouw kant</div>
              <div className="font-medium">
                {opponentSide}
                {opponentOutcome ? ` — ${opponentOutcome}` : ""}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span>{bet.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Verloopt</span>
              <span>{invite.expiresAt.toLocaleString("nl-NL")}</span>
            </div>
          </div>
          <AcceptInviteButton
            betId={bet.id}
            inviteToken={token}
            stakeLabel={stakeLabel}
          />
        </CardContent>
      </Card>
    </main>
  );
}

function InviteMessage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
