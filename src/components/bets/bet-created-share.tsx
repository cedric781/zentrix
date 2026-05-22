"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShareInviteCard } from "./share-invite-card";

interface Props {
  betId: string;
  inviteToken: string;
  expiresAt: Date;
}

export function BetCreatedShare({ betId, inviteToken, expiresAt }: Props) {
  const router = useRouter();
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!origin) return null;

  const inviteUrl = `${origin}/invite/${inviteToken}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          Bet aangemaakt
        </CardTitle>
        <CardDescription>
          Deel de invite-link met je tegenstander om de bet te starten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ShareInviteCard
          betId={betId}
          inviteUrl={inviteUrl}
          expiresAt={expiresAt}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => router.push(`/bets/${betId}`)}
        >
          Klaar — naar bet detail
        </Button>
      </CardContent>
    </Card>
  );
}
