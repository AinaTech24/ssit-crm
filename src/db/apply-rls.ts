import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "./client";

async function applyRLS() {
  console.log("Applying Row Level Security (RLS) policies...");
  const sqlPath = path.join(process.cwd(), "drizzle", "migrations", "0001_rls_policies.sql");
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Migration SQL file not found at ${sqlPath}`);
  }
  const sql = fs.readFileSync(sqlPath, "utf-8");
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Running RLS policy migration script...");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("✓ RLS policies applied successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to apply RLS policies:", err);
    throw err;
  } finally {
    client.release();
  }
}

applyRLS()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
