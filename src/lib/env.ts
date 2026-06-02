// CANONICAL: env loader. Application refuses to start if required vars missing.
// Reference: docs/LESSONS_FROM_WAGER.md R8 (one env store, validated at startup).

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  // P61b — server-side wallet API authorization. Required for
  // signAndSendTransaction against TEE wallets; absent in dev is OK.
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().min(50).optional(),
  NEXT_PUBLIC_PRIVY_SIGNER_ID: z.string().min(20).optional(),
  HELIUS_RPC_URL: z.string().url().optional(),
  HELIUS_WEBHOOK_SECRET: z.string().min(1).optional(),
  HELIUS_WEBHOOK_ID: z.string().min(1).optional(),
  USDC_MINT_ADDRESS: z.string().min(32).max(44).optional(),
  FEE_WALLET_ADDRESS: z.string().min(32).max(44),
  ESCROW_WALLET_ADDRESS: z.string().min(32).max(44),
  CRON_SECRET: z.string().min(32).optional(),
  DEPOSITS_DISABLED: z.coerce.boolean().default(false),
  WITHDRAWALS_DISABLED: z.coerce.boolean().default(false),
  BETS_DISABLED: z.coerce.boolean().default(false),
  WITHDRAWAL_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  WITHDRAWAL_FEE_MIN_USDC: z.string().default("0.5"),
  WITHDRAWAL_FEE_MAX_USDC: z.string().default("10"),
  WITHDRAWAL_MIN_USDC: z.string().default("1"),
  PLATFORM_TREASURY_SCOPE: z.string().default("treasury"),
  ADMIN_API_TOKEN: z.string().min(32).optional(),
  ADMIN_USER_IDS: z.string().optional(),
  // Privy walletId for the escrow server-wallet (e.g. "ttf3kalpidc4jkkf396gkqjn").
  // Used to sign via the walletId path since escrow has no associated Privy
  // user (ownerId: null) — the address path fails with "User not found".
  // Required by the payout cron to release escrow on-chain.
  ESCROW_WALLET_ID: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  POOL_MIN_BET_USDC: z.string().default("1"),
  POOL_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(200),
  POOL_CREATOR_FEE_BPS_MIN: z.coerce.number().int().min(0).max(1000).default(100),
  POOL_CREATOR_FEE_BPS_MAX: z.coerce.number().int().min(0).max(1000).default(500),
  SETTLEMENT_DELAY_MIN_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  SETTLEMENT_DELAY_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  CREATOR_DECLARE_GRACE_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
  POOL_DISPUTE_HOLD_THRESHOLD_PCT: z.coerce.number().int().min(0).max(100).default(50),
  BET_MIN_USDC_UNITS: z.coerce.bigint().default(1_000_000n),
  BET_MAX_USDC_UNITS: z.coerce.bigint().default(10_000_000_000n),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      "Invalid environment configuration:\n" +
        parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  cached = parsed.data;
  return cached;
}

export function _resetEnvCache() {
  cached = null;
}

// Alias for spec compatibility — see PROMPT_13 §2
export const env = getEnv;