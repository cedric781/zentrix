"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/feed", label: "My bets" },
  { href: "/templates", label: "Browse" },
  { href: "/bets/new", label: "Create bet" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: Props) {
  const pathname = usePathname();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 sm:hidden">
      <button
        type="button"
        aria-label="Close menu"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="absolute right-0 top-0 bottom-0 w-72 bg-background border-l shadow-xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <span className="text-sm font-semibold tracking-tight">Menu</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="p-4 space-y-1 flex-1">
          {NAV_LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                className={cn(
                  "block px-3 py-3 min-h-[44px] text-sm rounded-md transition-colors",
                  active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
