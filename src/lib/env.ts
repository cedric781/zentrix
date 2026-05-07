// CANONICAL: env loader. Application refuses to start if required vars missing.
// Reference: docs/LESSONS_FROM_WAGER.md R8 (one env store, validated at startup).

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  HELIUS_RPC_URL: z.string().url().optional(),
  HELIUS_WEBHOOK_SECRET: z.string().min(1).optional(),
  HELIUS_WEBHOOK_ID: z.string().min(1).optional(),
  USDC_MINT_ADDRESS: z.string().min(32).max(44).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  DEPOSITS_DISABLED: z.coerce.boolean().default(false),
  WITHDRAWALS_DISABLED: z.coerce.boolean().default(false),
  WITHDRAWAL_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  WITHDRAWAL_FEE_MIN_USDC: z.string().default("0.5"),
  WITHDRAWAL_FEE_MAX_USDC: z.string().default("10"),
  WITHDRAWAL_MIN_USDC: z.string().default("1"),
  PLATFORM_TREASURY_SCOPE: z.string().default("treasury"),
  ADMIN_API_TOKEN: z.string().min(32).optional(),
  SENTRY_DSN: z.string().url().optional(),
  POOL_MIN_BET_USDC: z.string().default("1"),
  POOL_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(200),
  POOL_CREATOR_FEE_BPS_MIN: z.coerce.number().int().min(0).max(1000).default(100),
  POOL_CREATOR_FEE_BPS_MAX: z.coerce.number().int().min(0).max(1000).default(500),
  SETTLEMENT_DELAY_MIN_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  SETTLEMENT_DELAY_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  CREATOR_DECLARE_GRACE_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
  POOL_DISPUTE_HOLD_THRESHOLD_PCT: z.coerce.number().int().min(0).max(100).default(50),
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