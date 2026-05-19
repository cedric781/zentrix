"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

export function AppHeader() {
  const pathname = usePathname();
  const { authenticated, ready } = usePrivy();

  if (pathname === "/" || pathname === "/signin") return null;

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between gap-4 px-4 mx-auto max-w-6xl">
        <Link
          href={authenticated ? "/feed" : "/"}
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="text-base">Zentrix</span>
        </Link>

        {ready && authenticated && (
          <nav className="hidden sm:flex items-center gap-1 text-sm font-mono">
            <NavLink href="/feed" current={pathname}>
              My bets
            </NavLink>
            <NavLink href="/templates" current={pathname}>
              Browse
            </NavLink>
          </nav>
        )}

        <div className="flex items-center gap-2">
          {ready && authenticated ? (
            <>
              <Button asChild size="sm" className="gap-1.5">
                <Link href="/bets/new">
                  <Plus size={14} />
                  <span className="hidden sm:inline">Create bet</span>
                  <span className="sm:hidden">New</span>
                </Link>
              </Button>
              <UserMenu />
            </>
          ) : ready && !authenticated ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/signin">Sign in</Link>
            </Button>
          ) : (
            <div className="w-20 h-8" />
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: string;
  children: React.ReactNode;
}) {
  const active = current === href || current.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "px-3 py-1.5 rounded-md transition-colors",
        active
          ? "text-foreground bg-muted"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </Link>
  );
}
