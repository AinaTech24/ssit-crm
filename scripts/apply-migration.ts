import "dotenv/config";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db/client";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/apply-migration.ts <path-to-sql>");
    process.exit(1);
  }
  const text = readFileSync(path, "utf8");
  console.log(`[apply] ${path} — ${text.length} chars`);
  await withSystem(async (tx) => {
    await tx.execute(sql.raw(text));
  });
  console.log("[apply] done");
  process.exit(0);
}
main().catch((e) => {
  console.error("[apply] failed:", e?.message ?? e);
  console.error(e);
  process.exit(1);
});
