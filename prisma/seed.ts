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
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });