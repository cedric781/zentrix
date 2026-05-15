"use client";

import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";
import { usePrivy } from "@privy-io/react-auth";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type DepositModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DepositModal({ open, onOpenChange }: DepositModalProps) {
  const { user } = usePrivy();
  const walletAddress = user?.wallet?.address ?? null;
  // QR codes are always rendered as dark-on-light for universal scanner
  // reliability, regardless of the surrounding theme. The white container
  // around the QR provides the required contrast.
  const fgColor = "#000000";
  const bgColor = "#ffffff";

  const handleCopy = async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn’t copy address");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit USDC</DialogTitle>
          <DialogDescription>
            Send USDC on Solana to this address. Funds appear within ~1 minute
            after network confirmation.
          </DialogDescription>
        </DialogHeader>

        {walletAddress ? (
          <>
            <div
              className="mx-auto flex items-center justify-center rounded-lg p-4"
              style={{ backgroundColor: bgColor }}
            >
              <QRCodeSVG
                value={walletAddress}
                size={200}
                level="M"
                fgColor={fgColor}
                bgColor={bgColor}
              />
            </div>

            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
              <code
                className="flex-1 select-all break-all font-mono text-xs"
                title={walletAddress}
              >
                {walletAddress}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                aria-label="Copy address"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs">
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500"
                aria-hidden="true"
              />
              <p className="leading-relaxed">
                <strong>Solana network only.</strong> Send USDC SPL token (mint{" "}
                <code className="break-all font-mono">{USDC_MINT}</code>).
                Tokens on other networks <strong>will be lost</strong>.
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Wallet address not available. Please reconnect your account.
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
