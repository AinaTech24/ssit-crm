/**
 * Re-queue every RTA file that still exists in S3 AND opens with the firm's saved
 * password. Files encrypted with a different password are skipped — re-running
 * them only reproduces the same failure.
 *
 *   npx tsx scripts/requeue-openable.ts [--commit]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getObjectBytes } from "@/lib/storage/s3";
import { getMailbackPasswords } from "@/lib/rta/mailback-config";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { Q } from "@/workers/queues";

const COMMIT = process.argv.includes("--commit");
const RICH = new Set(["folio_master_dump", "cas_holdings"]);
const SYS = "00000000-0000-0000-0000-000000000000";

async function main() {
  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, tenant_id, source, kind, file_name, file_key, file_size_bytes, created_at
      FROM rta_file_imports
      WHERE deleted_at IS NULL AND file_key IS NOT NULL AND status <> ${"completed"}
        AND created_at > now() - ${"4 days"}::interval
      ORDER BY created_at ASC`);
    return r.rows as any[];
  });

  let queued = 0;
  for (const r of rows) {
    const pw = await withTenant(r.tenant_id, async (tx) => getMailbackPasswords(tx, r.tenant_id));
    const password = (r.source === "cams" ? pw.camsPassword : pw.kfintechPassword) || undefined;
    let buf: Buffer;
    try { buf = await getObjectBytes(r.file_key); } catch { continue; }
    // Only ZIPs need a password. KFintech link-downloads arrive as plain CSV, so
    // requiring extractRtaFileFromZip to succeed silently skipped every one of
    // them — the worker itself checks the PK magic before unzipping, so match it.
    const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (isZip) {
      try { await extractRtaFileFromZip(new Uint8Array(buf), password); }
      catch { continue; } // wrong password / other subscription — skip silently
    }
    // Masters must land before transaction feeds, so order by kind then date.
    console.log(`  ${COMMIT ? "QUEUE" : "would"}  ${r.kind.padEnd(24)} ${String(r.file_size_bytes).padStart(9)}b  ${String(r.created_at).slice(4,20)}`);
    if (!COMMIT) continue;
    await withTenant(r.tenant_id, async (tx) => {
      await tx.execute(sql`UPDATE rta_file_imports SET status=${"uploaded"}, remarks=${"Re-queued after CSV quoting fix"}, parsed_at=NULL WHERE id=${r.id}::uuid`);
    });
    const opts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
    if (RICH.has(r.kind)) {
      await Q.rtaImport().add("rich-import", { mode: "rich", importId: r.id, tenantId: r.tenant_id, key: r.file_key,
        filename: r.file_name, password, rta: r.source, reportType: "", dryRun: false, assignToMe: false, userId: SYS, roles: [] }, opts);
    } else {
      await Q.rtaImport().add("import", { importId: r.id, tenantId: r.tenant_id, source: r.source, kind: r.kind,
        key: r.file_key, filename: r.file_name, password, userId: SYS, roles: [] }, opts);
    }
    queued++;
  }
  console.log(COMMIT ? `\nQueued ${queued} file(s).` : `\nDry run — ${rows.length} candidates scanned.`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(String(e).slice(0,300));process.exit(1);});
