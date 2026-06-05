// CANONICAL: Prisma client singleton.
// Avoids creating multiple clients during HMR in development.

import { PrismaClient } from "@prisma/client";
import { assertTestDb } from "./__guards__/assert-test-db";

declare global {
  // eslint-disable-next-line no-var
  var _prismaClient: PrismaClient | undefined;
}

// B1 fail-closed: second layer for ad-hoc tsx/scripts that bypass vitest's
// setup. Only under test — prod/dev construction paths are untouched.
if (process.env.NODE_ENV === "test") {
  assertTestDb();
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