-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('USER', 'BET_ESCROW', 'TREASURY', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEPOSIT_CREDIT', 'WITHDRAWAL_DEBIT', 'WITHDRAWAL_REVERSAL', 'ESCROW_LOCK', 'ESCROW_RELEASE', 'SETTLEMENT_PAYOUT', 'FEE_COLLECTION', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CREDITED', 'FAILED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING_VALIDATION', 'QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "privy_id" TEXT NOT NULL,
    "email" TEXT,
    "embedded_wallet_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "scope_key" TEXT NOT NULL,
    "user_id" TEXT,
    "balance_units" BIGINT NOT NULL DEFAULT 0,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "initiator_user_id" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "total_debits" BIGINT NOT NULL,
    "total_credits" BIGINT NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "is_balanced" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "debit_account_id" TEXT NOT NULL,
    "credit_account_id" TEXT NOT NULL,
    "amount_units" BIGINT NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "debit_balance_after" BIGINT NOT NULL,
    "credit_balance_after" BIGINT NOT NULL,
    "note" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tx_signature" TEXT NOT NULL,
    "log_index" INTEGER NOT NULL DEFAULT 0,
    "amount_units" BIGINT NOT NULL,
    "slot" BIGINT NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "ledger_tx_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credited_at" TIMESTAMP(3),

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "amount_units" BIGINT NOT NULL,
    "fee_units" BIGINT NOT NULL DEFAULT 0,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "ledger_tx_id" TEXT,
    "reversal_ledger_tx_id" TEXT,
    "tx_signature" TEXT,
    "fail_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "reconciliation_logs" (
    "id" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ledger_total_units" BIGINT NOT NULL,
    "on_chain_total_units" BIGINT,
    "delta" BIGINT,
    "notes" TEXT,

    CONSTRAINT "reconciliation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_privy_id_key" ON "users"("privy_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_embedded_wallet_address_key" ON "users"("embedded_wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_scope_key_key" ON "financial_accounts"("scope_key");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_user_id_key" ON "financial_accounts"("user_id");

-- CreateIndex
CREATE INDEX "idx_financial_accounts_type" ON "financial_accounts"("account_type");

-- CreateIndex
CREATE INDEX "idx_financial_accounts_balance" ON "financial_accounts"("balance_units");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_ledger_tx_ref" ON "ledger_transactions"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "idx_ledger_tx_created" ON "ledger_transactions"("created_at");

-- CreateIndex
CREATE INDEX "idx_ledger_entries_tx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_ledger_entries_debit" ON "ledger_entries"("debit_account_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ledger_entries_credit" ON "ledger_entries"("credit_account_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ledger_entries_type" ON "ledger_entries"("entry_type");

-- CreateIndex
CREATE INDEX "idx_deposits_user_created" ON "deposits"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_deposits_status" ON "deposits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_deposits_tx_log" ON "deposits"("tx_signature", "log_index");

-- CreateIndex
CREATE INDEX "idx_withdrawals_user_created" ON "withdrawals"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_withdrawals_status" ON "withdrawals"("status");

-- CreateIndex
CREATE INDEX "idx_idem_scope_created" ON "idempotency_keys"("scope", "created_at");

-- CreateIndex
CREATE INDEX "idx_recon_checked_at" ON "reconciliation_logs"("checked_at");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
