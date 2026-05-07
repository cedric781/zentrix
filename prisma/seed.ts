import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.financialAccount.upsert({
    where: { scopeKey: "treasury" },
    create: {
      accountType: "TREASURY",
      scopeKey: "treasury",
      label: "Platform fee treasury",
    },
    update: {},
  });

  await prisma.financialAccount.upsert({
    where: { scopeKey: "external" },
    create: {
      accountType: "EXTERNAL",
      scopeKey: "external",
      label: "Synthetic external counter-account for on-chain flows",
    },
    update: {},
  });

  console.log("Seeded singleton accounts: treasury, external");

  const breakers = ["deposits", "withdrawals", "settlement"];
  for (const key of breakers) {
    await prisma.circuitBreaker.upsert({
      where: { key },
      create: { key, isOpen: false },
      update: {},
    });
  }
  console.log(`Seeded circuit breakers: ${breakers.join(", ")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });