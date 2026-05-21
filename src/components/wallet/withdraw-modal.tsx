"use client";

import { useState, useMemo } from "react";
import { ArrowUpFromLine, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePrivy } from "@privy-io/react-auth";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useWithdrawalFee } from "@/hooks/use-withdrawal-fee";
import { useCreateWithdrawal } from "@/hooks/use-create-withdrawal";
import { useBalance } from "@/hooks/use-balance";
import { useWalletDelegation } from "@/hooks/use-wallet-delegation";
import { getWithdrawalErrorMessage } from "@/lib/withdrawals/error-messages";
import { WalletDelegationPrompt } from "./wallet-delegation-prompt";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Convert decimal USDC string ("10.5") → micro-units BigInt string ("10500000")
 * Returns null on invalid input.
 */
function decimalToMicroUnits(decimal: string): string | null {
  if (!/^\d+(\.\d{1,6})?$/.test(decimal.trim())) return null;
  const [whole, frac = ""] = decimal.trim().split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  try {
    const microUnits = BigInt(whole) * 1_000_000n + BigInt(fracPadded);
    if (microUnits <= 0n) return null;
    return microUnits.toString();
  } catch {
    return null;
  }
}

function formatMicroUsdc(micro: string | bigint): string {
  const val = Number(BigInt(micro)) / 1_000_000;
  return val.toFixed(2);
}

/**
 * Naive Solana address shape check — server does authoritative parseSolanaAddress.
 * UX feedback only.
 */
function looksLikeSolanaAddress(addr: string): boolean {
  if (addr.startsWith("0x")) return false;
  if (addr.length < 32 || addr.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr);
}

export function WithdrawModal({ open, onOpenChange }: Props) {
  const { authenticated } = usePrivy();
  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");

  const { data: balanceData } = useBalance();
  const balanceMicro = balanceData?.balanceUnits ?? "0";

  const amountMicro = useMemo(() => decimalToMicroUnits(amount), [amount]);
  const { data: feeData, isLoading: feeLoading } = useWithdrawalFee(
    amountMicro ?? "",
  );

  const createMutation = useCreateWithdrawal();
  const delegation = useWalletDelegation();
  const isAuthorized = delegation.status === "AUTHORIZED";

  const addressLooksValid =
    toAddress.length === 0 || looksLikeSolanaAddress(toAddress);
  const addressIsEvm = toAddress.startsWith("0x");

  const canSubmit =
    authenticated &&
    isAuthorized &&
    !!amountMicro &&
    BigInt(amountMicro) > 0n &&
    BigInt(amountMicro) <= BigInt(balanceMicro) &&
    looksLikeSolanaAddress(toAddress) &&
    !createMutation.isPending;

  async function handleSubmit() {
    if (!canSubmit || !amountMicro) return;
    try {
      const result = await createMutation.mutateAsync({
        amountUsdc: amount,
        toAddress: toAddress.trim(),
      });
      toast.success(
        `Withdrawal queued: ${formatMicroUsdc(result.netUsdc)} USDC en route`,
      );
      setAmount("");
      setToAddress("");
      onOpenChange(false);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      toast.error(getWithdrawalErrorMessage(code));
    }
  }

  function handleMaxClick() {
    setAmount(formatMicroUsdc(balanceMicro));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpFromLine className="h-4 w-4 text-[#2563EB]" />
            Withdraw USDC
          </DialogTitle>
          <DialogDescription>
            Send USDC from your Zentrix balance to any Solana wallet. Arrives in
            under a minute.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isAuthorized && <WalletDelegationPrompt />}

          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Available</span>
            <span className="font-mono font-medium">
              {formatMicroUsdc(balanceMicro)} USDC
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount" className="text-xs">
                Amount (USDC)
              </Label>
              <button
                type="button"
                onClick={handleMaxClick}
                className="text-xs text-[#2563EB] hover:underline"
              >
                Max
              </button>
            </div>
            <Input
              id="amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono"
              disabled={createMutation.isPending}
            />
            {amount && !amountMicro && (
              <p className="text-xs text-destructive">
                Enter a valid amount (max 6 decimals).
              </p>
            )}
            {amountMicro && BigInt(amountMicro) > BigInt(balanceMicro) && (
              <p className="text-xs text-destructive">
                Exceeds available balance.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="toAddress" className="text-xs">
              Destination Solana address
            </Label>
            <Input
              id="toAddress"
              type="text"
              placeholder="Enter a Solana wallet address"
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              className="font-mono text-xs"
              disabled={createMutation.isPending}
            />
            {toAddress && !addressLooksValid && !addressIsEvm && (
              <p className="text-xs text-destructive">
                Doesn&apos;t look like a Solana address.
              </p>
            )}
            {addressIsEvm && (
              <p className="text-xs text-destructive">
                ⚠️ EVM address detected. Zentrix is on Solana — funds would be
                lost.
              </p>
            )}
          </div>

          {amountMicro && BigInt(amountMicro) > 0n && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm space-y-1">
              {feeLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Calculating fee…
                </div>
              ) : feeData ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Network fee</span>
                    <span className="font-mono">
                      {formatMicroUsdc(feeData.feeUsdc)} USDC
                    </span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>You&apos;ll receive</span>
                    <span className="font-mono">
                      {formatMicroUsdc(feeData.netUsdc)} USDC
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
            className="sm:w-auto w-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            title={!isAuthorized ? "Enable withdrawals above first" : undefined}
            className="bg-[#2563EB] hover:bg-[#2563EB]/90 text-white sm:w-auto w-full"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Withdraw"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
