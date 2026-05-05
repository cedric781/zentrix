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
  });

if (process.env.NODE_ENV !== "production") {
  global._prismaClient = prisma;
}