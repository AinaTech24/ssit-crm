import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import "dotenv/config";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-migration.mjs <path-to-sql>");
  process.exit(2);
}
const sql = readFileSync(resolve(file), "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(sql);
  console.log(`Applied: ${file}`);
} catch (e) {
  console.error("Migration failed:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
