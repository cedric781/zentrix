"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, Settings, User, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { user, logout, authenticated, ready } = usePrivy();

  if (!ready || !authenticated || !user) return null;

  const email = user.email?.address ?? user.google?.email ?? null;
  const wallet = user.wallet?.address ?? null;
  const label = email ?? (wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "Account");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <User size={14} />
          <span className="hidden sm:inline text-xs font-mono">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-mono">
          {email ?? "Wallet"}
        </DropdownMenuLabel>
        {wallet && (
          <DropdownMenuLabel className="text-[10px] font-mono text-muted-foreground -mt-1">
            {wallet.slice(0, 8)}…{wallet.slice(-6)}
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/feed" className="cursor-pointer">
            <Wallet size={14} className="mr-2" />
            My bets
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/me" className="cursor-pointer">
            <Settings size={14} className="mr-2" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut size={14} className="mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
