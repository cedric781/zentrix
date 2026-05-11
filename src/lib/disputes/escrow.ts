import "server-only";
import type { TxClient } from "@/lib/ledger";
import { disputeScopeKey } from "@/lib/ledger/accounts";

export async function getOrCreateDisputeEscrowAccount(
  tx: TxClient,
  disputeId: string,
) {
  const scopeKey = disputeScopeKey(disputeId);
  const existing = await tx.financialAccount.findUnique({ where: { scopeKey } });
  if (existing) return existing;
  try {
    return await tx.financialAccount.create({
      data: {
        accountType: "BET_ESCROW",
        scopeKey,
        balanceUnits: 0n,
        label: `Dispute escrow for ${disputeId}`,
      },
    });
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      return await tx.financialAccount.findUniqueOrThrow({ where: { scopeKey } });
    }
    throw err;
  }
}
