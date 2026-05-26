"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useWalletDelegation } from "@/hooks/use-wallet-delegation";
import { acceptBet } from "@/lib/api/bets";
import { ApiError } from "@/lib/api/client";

interface Props {
  betId: string;
  inviteToken: string;
  stakeLabel: string;
}

export function AcceptInviteButton({ betId, inviteToken, stakeLabel }: Props) {
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const { status: delegationStatus } = useWalletDelegation();
  const [pending, setPending] = useState(false);

  if (isLoading) {
    return (
      <Button disabled className="w-full">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Laden…
      </Button>
    );
  }

  if (!me) {
    const next = `/invite/${inviteToken}`;
    return (
      <Button
        asChild
        className="w-full bg-[#2563EB] hover:bg-[#2563EB]/90 text-white"
      >
        <Link href={`/signin?next=${encodeURIComponent(next)}`}>
          Log in om deze bet te accepteren
        </Link>
      </Button>
    );
  }

  const canAccept = delegationStatus === "AUTHORIZED";
  const delegationLoading =
    delegationStatus === "LOADING" ||
    delegationStatus === "NO_EMBEDDED_WALLET" ||
    delegationStatus === "AUTHORIZING";

  async function handleAccept() {
    setPending(true);
    try {
      const result = await acceptBet(
        { betId, inviteToken },
        { idempotencyKey: crypto.randomUUID() },
      );
      toast.success("Bet geaccepteerd");
      router.push(`/bets/${result.bet.id}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "UNKNOWN";
      const fallback = err instanceof Error ? err.message : "";
      if (code === "BET_WALLET_NOT_DELEGATED") {
        toast.error("Wallet niet geautoriseerd", {
          description:
            "Autoriseer je wallet voordat je bets kunt accepteren.",
          action: {
            label: "Wallet instellingen",
            onClick: () => router.push("/me"),
          },
        });
      } else {
        toast.error(getAcceptErrorMessage(code, fallback));
      }
      setPending(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      <Button
        onClick={handleAccept}
        disabled={pending || !canAccept}
        className="w-full bg-[#2563EB] hover:bg-[#2563EB]/90 text-white"
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Accepteren…
          </>
        ) : delegationLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Wallet laden…
          </>
        ) : (
          `Accepteer bet voor ${stakeLabel}`
        )}
      </Button>
      {!canAccept && !delegationLoading && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="h-3 w-3 shrink-0" />
          <span>
            <Link href="/me" className="underline underline-offset-2">
              Autoriseer je wallet
            </Link>{" "}
            om bets te accepteren.
          </span>
        </div>
      )}
    </div>
  );
}

function getAcceptErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case "BET_INVITE_INVALID":
    case "INVITE_NOT_FOUND":
      return "Deze invite is niet meer geldig.";
    case "BET_ALREADY_ACCEPTED":
    case "INVITE_ALREADY_USED":
      return "Deze bet is al geaccepteerd.";
    case "BET_EXPIRED":
    case "INVITE_EXPIRED":
      return "De accept-deadline is verstreken.";
    case "BET_INVALID_STATUS":
    case "INVITE_BET_NOT_OPEN":
      return "Deze bet accepteert geen nieuwe deelnemers meer.";
    case "BET_INSUFFICIENT_BALANCE":
      return "Onvoldoende saldo om deze bet te accepteren.";
    case "BET_INVALID_INPUT":
    case "INVITE_SELF_REDEEM":
      return "Je kunt je eigen bet niet accepteren.";
    case "BET_VERSION_MISMATCH":
      return "Concurrent update — probeer opnieuw.";
    case "BET_WALLET_NOT_DELEGATED":
      return "Autoriseer je wallet via instellingen om bets te accepteren.";
    case "unauthorized":
      return "Log in om deze bet te accepteren.";
    default:
      return fallback || "Accepteren mislukt — probeer opnieuw.";
  }
}
