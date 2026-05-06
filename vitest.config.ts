import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
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