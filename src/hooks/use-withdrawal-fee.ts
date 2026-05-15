"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { getWithdrawalFee } from "@/lib/api/withdrawals";

const DEBOUNCE_MS = 300;
const STALE_MS = 30_000;

function isPositiveBigIntString(s: string): boolean {
  if (s === "") return false;
  try {
    return BigInt(s) > 0n;
  } catch {
    return false;
  }
}

export function useWithdrawalFee(amountUsdc: string) {
  const { ready, authenticated } = usePrivy();
  const [debounced, setDebounced] = useState(amountUsdc);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(amountUsdc), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [amountUsdc]);

  const valid = isPositiveBigIntString(debounced);

  return useQuery({
    queryKey: ["withdrawals", "fee", debounced],
    queryFn: ({ signal }) => getWithdrawalFee(debounced, { signal }),
    enabled: ready && authenticated && valid,
    staleTime: STALE_MS,
  });
}
