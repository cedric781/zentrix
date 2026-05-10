// CANONICAL: Prisma client singleton.
// Avoids creating multiple clients during HMR in development.

import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var _prismaClient: PrismaClient | undefined;
}

export const prisma =
  global._prismaClient ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
    transactionOptions: {
      // Default Prisma is maxWait 2s / timeout 5s — too tight when running tests
      // against Neon (~150ms RTT × dozens of queries inside a single tx).
      maxWait: 10_000,
      timeout: 30_000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  global._prismaClient = prisma;
}