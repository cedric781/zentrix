import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "@prisma/client";
import { parseTemplates } from "./lib/wager-template-parser";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("=== P21 Template Seeder ===");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no DB writes)" : "LIVE (writes to production)"}`);
  console.log("");

  const templates = parseTemplates();
  console.log(`Parsed ${templates.length} templates from Wager source.`);
  console.log("");

  // Show what would happen
  console.log("Templates to upsert:");
  console.log(
    templates.map((t, i) => `  ${i + 1}. ${t.slug} (${t.category}, ${t.outcomeType})`).join("\n")
  );
  console.log("");

  if (DRY_RUN) {
    console.log("DRY-RUN complete. No DB writes.");
    console.log("Run without --dry-run to seed templates.");
    return;
  }

  // Live mode: require explicit confirmation
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `About to seed ${templates.length} templates to PRODUCTION Neon. Continue? (y/N) `,
      (a) => {
        rl.close();
        resolve(a.trim().toLowerCase());
      }
    );
  });

  if (answer !== "y" && answer !== "yes") {
    console.log("Aborted by user.");
    process.exit(0);
  }

  // Seed
  const prisma = new PrismaClient();
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    try {
      const existing = await prisma.betTemplate.findUnique({ where: { slug: t.slug } });
      await prisma.betTemplate.upsert({
        where: { slug: t.slug },
        create: t,
        update: t,
      });
      if (existing) {
        updated++;
        console.log(`  [${i + 1}/${templates.length}] UPDATED ${t.slug}`);
      } else {
        created++;
        console.log(`  [${i + 1}/${templates.length}] CREATED ${t.slug}`);
      }
    } catch (e: any) {
      errors++;
      console.error(`  [${i + 1}/${templates.length}] ERROR ${t.slug}: ${e.message}`);
    }
  }

  console.log("");
  console.log(`=== Result: ${created} created, ${updated} updated, ${errors} errors ===`);

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
