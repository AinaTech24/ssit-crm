/**
 * Run ONE rich-import job directly (bypassing BullMQ) and print the FULL error
 * — message, cause, stack — for a job that's failing inside the worker with
 * only `[capture] ... job failed: <message>` visible in logs (captureError
 * only logs `.message`, never `.cause`/`.stack`, so the real Postgres error
 * behind a DrizzleQueryError is invisible in normal operation).
 *
 *   npx tsx scripts/diag-rich-import.ts <importId>
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getMailbackPasswords, passwordCandidates } from "@/lib/rta/mailback-config";
import { runRichImportJob } from "@/workers/rta-import-worker";

const ID = process.argv[2];

function dump(e: any, depth = 0): void {
  if (!e || depth > 4) return;
  const pad = "  ".repeat(depth);
  console.log(`${pad}name   : ${e?.name}`);
  console.log(`${pad}message: ${e?.message}`);
  console.log(`${pad}code   : ${e?.code ?? "(none)"}`);
  console.log(`${pad}detail : ${e?.detail ?? "(none)"}`);
  console.log(`${pad}stack  :`);
  console.log(String(e?.stack ?? "(none)").split("\n").slice(0, 10).map((l: string) => pad + "  " + l).join("\n"));
  if (e?.cause) {
    console.log(`${pad}cause ->`);
    dump(e.cause, depth + 1);
  }
}

async function main() {
  if (!ID) {
    console.error("Usage: npx tsx scripts/diag-rich-import.ts <importId>");
    process.exit(1);
  }
  const r = await withSystem(async (tx) => {
    const res = await tx.execute(sql`
      SELECT tenant_id, source, kind, file_name, file_key FROM rta_file_imports WHERE id = ${ID}::uuid`);
    return res.rows[0] as any;
  });
  console.log("row:", JSON.stringify(r));

  const pw = await withTenant(r.tenant_id, async (tx) => getMailbackPasswords(tx, r.tenant_id));
  const passwords = passwordCandidates(pw, r.source).map((e) => e.password);
  console.log("candidate passwords:", passwords.length);

  try {
    const result = await runRichImportJob({
      mode: "rich",
      importId: ID,
      tenantId: r.tenant_id,
      key: r.file_key,
      filename: r.file_name,
      passwords,
      rta: r.source,
      reportType: "",
      dryRun: true, // read-only preview — no writes to the client book
      assignToMe: false,
      userId: "00000000-0000-0000-0000-000000000000",
      roles: [],
    });
    console.log("\nresult:", JSON.stringify(result, null, 2)?.slice(0, 2000));
  } catch (e: any) {
    console.log("\n*** THREW ***");
    dump(e);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("TOP-LEVEL:", String(e?.stack ?? e).slice(0, 800));
    process.exit(1);
  });
