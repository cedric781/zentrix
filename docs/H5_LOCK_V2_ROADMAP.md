# H.5 LOCK V2 — On-chain Bet Escrow Architecture

**Status:** Design lock (no implementation yet)
**Date:** 2026-05-25
**Author:** cedric781 + Claude

## Decision

Implement on-chain bet escrow using a dedicated Privy server-wallet.
Both stakes are locked in the escrow wallet at bet creation/acceptance.
Settlement pays winner from escrow. Void refunds both from escrow.

## Math (Wager-pot model, 2% of pot)

- 1 USDC stake per side
- potUnits = 2 USDC (sum of both stakes in escrow)
- feeUnits = 0.04 USDC (2% of pot)
- winnerPayout = 1.96 USDC

## Why escrow lock (and not wallet-to-wallet)

- Wager-pot math requires both stakes pooled = need escrow
- Prevents loser from emptying wallet between bet placement and settle
- Matches user mental model: "money is locked in the bet"

## Implementation Phases

### H.5a — Escrow wallet setup (manual)
- Create new Privy server wallet "Zentrix Bet Escrow"
- Add ESCROW_WALLET_ADDRESS to Vercel env
- Verify Privy authorization key can sign for escrow wallet

### H.5b — Schema delta
```prisma
enum EscrowDepositStatus {
  PENDING_CREATOR
  PENDING_OPPONENT
  LOCKED
  FAILED
}

model Bet {
  // additive to H.4 fields:
  escrowDepositStatus         EscrowDepositStatus?
  escrowDepositCreatorTxSig   String?
  escrowDepositOpponentTxSig  String?
  escrowDepositAttemptedAt    DateTime?
  escrowDepositLastError      String?
}
```

### H.5c — createBet flow flip
- Add transferUsdcOnChain(creator -> escrow) BEFORE bet status OPEN
- Failure -> bet not created, no ledger entries

### H.5d — acceptBet flow flip
- Add transferUsdcOnChain(opponent -> escrow) BEFORE bet status ACTIVE

### H.5e — Settle finalizer wire
- After markLedgerFinalized in SETTLE branch:
  - transferUsdcOnChain(escrow -> winner, 1.96)
  - transferUsdcOnChain(escrow -> fee wallet, 0.04)

### H.5f — VOID branch
- transferUsdcOnChain(escrow -> creator, 1.00)
- transferUsdcOnChain(escrow -> opponent, 1.00)

### H.5g — Failure handling
- Cron retry on FAILED deposits/payouts (extend G.3.5 pattern)
- Admin escalation after FAILED_TERMINAL

### H.5h — Frontend updates
- Loading state in bet create (10-30s wait on-chain confirm)
- H.2.5 delegation prompt redirect

## Already Completed (Foundation)

- H.2: Force delegation guard (bd83635)
- H.3: transferUsdcOnChain helper (3cc6266)
- H.4: Payout schema fields (745bec8)
- H.4b: FEE_WALLET_ADDRESS env (e5879f8)

## Risks

1. Privy server-wallet signing: untested for app-owned wallets (only user-delegated tested)
2. Frontend UX: bet creation blocks 10-30s = UX regression vs current instant
3. Escrow wallet SOL drain: needs monitoring + topup
4. Failure mid-flow: ledger committed, chain failed = inconsistency
5. Migration: existing settled bets retain ledger-only math (no rollback)

## Next Session

Start with H.5a (escrow wallet creation via Privy dashboard).
