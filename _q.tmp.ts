import "dotenv/config";
import { sql } from "drizzle-orm";
process.env.ALLOW_SYSTEM_TX = "1";
async function main() {
  const { withSystem } = await import("./src/db/client");
  await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id, rm_id, subject FROM review_meetings ORDER BY created_at DESC LIMIT 3`);
    console.log(JSON.stringify(r.rows));
    const u = await tx.execute(sql`SELECT id, email FROM users WHERE email='owner@demo.in'`);
    console.log("owner:", JSON.stringify(u.rows));
  });
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
