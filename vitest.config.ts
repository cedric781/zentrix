import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      PRIVY_APP_ID: "test",
      PRIVY_APP_SECRET: "test",
      HELIUS_RPC_URL: "https://example.com/rpc",
      USDC_MINT_ADDRESS: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
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