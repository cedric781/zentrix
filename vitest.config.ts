import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    pool: "threads",
    maxWorkers: 1,
    isolate: true,
    testTimeout: 30000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      PRIVY_APP_ID: "mock-privy-app-id-for-tests",
      PRIVY_APP_SECRET: "mock-privy-app-secret-for-tests",
      HELIUS_RPC_URL: "https://example.com/rpc",
      HELIUS_WEBHOOK_SECRET: "mock-webhook-secret-for-tests",
      HELIUS_WEBHOOK_ID: "mock-webhook-id",
      USDC_MINT_ADDRESS: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      CRON_SECRET: "mock-cron-secret-with-at-least-32-characters-for-tests",
      ADMIN_API_TOKEN: "mock-admin-token-with-at-least-32-characters-for-tests",
      POOL_MIN_BET_USDC: "1",
      POOL_PLATFORM_FEE_BPS: "200",
      POOL_CREATOR_FEE_BPS_MIN: "100",
      POOL_CREATOR_FEE_BPS_MAX: "500",
      SETTLEMENT_DELAY_MIN_HOURS: "24",
      SETTLEMENT_DELAY_MAX_HOURS: "48",
      CREATOR_DECLARE_GRACE_HOURS: "168",
      POOL_DISPUTE_HOLD_THRESHOLD_PCT: "50",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/__tests__/stubs/server-only.ts"),
    },
  },
});