"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  targetDate: Date | string | null;
  label?: string;
  className?: string;
  onExpire?: () => void;
};

function formatDuration(ms: number): string {
  if (ms <= 0) return "Expired";

  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function CountdownTimer({
  targetDate,
  label,
  className,
  onExpire,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!targetDate) return;

    const target = new Date(targetDate).getTime();
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= target && !expired) {
        setExpired(true);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate, expired, onExpire]);

  if (!targetDate) {
    return null;
  }

  const target = new Date(targetDate).getTime();
  const remaining = target - now;
  const isUrgent = remaining > 0 && remaining < 60 * 60 * 1000;

  return (
    <div className={cn("flex flex-col items-end", className)}>
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          remaining <= 0 && "text-muted-foreground",
          isUrgent && "text-[var(--brand)]",
        )}
      >
        {formatDuration(remaining)}
      </span>
    </div>
  );
}
