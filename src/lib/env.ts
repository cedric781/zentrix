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