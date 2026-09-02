/**
 * Re-test every RETAINED (non-completed) import against the firm's CURRENT
 * saved passwords, and optionally re-queue the ones that now open.
 *
 * Why this exists: a `rejected` ("not this firm's file") verdict is only as good
 * as the password set at the time it was made. When a firm adds or corrects a
 * mailback password, files previously dismissed as somebody else's may in fact
 * be theirs — but nothing re-examines them, so that data stays invisible.
 *
 * Testing is cheap (open the archive in memory, import nothing), so we probe
 * first and re-queue ONLY what actually opens, instead of churning the
 * concurrency-1 import queue through hundreds of files that will just fail again.
 *
 *   npx tsx scripts/retest-passwords.ts            # probe only, changes nothing
 *   npx tsx scripts/retest-passwords.ts --commit   # re-queue what now opens
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getObjectBytes } from "@/lib/storage/s3";
import { getMailbackPasswords, passwordCandidates } from "@/lib/rta/mailback-config";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { Q } from "@/workers/queues";

const COMMIT = process.argv.includes("--commit");
const RICH = new Set(["folio_master_dump", "cas_holdings"]);
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
// Above this, an archive is size-guarded downstream anyway — probing it costs
// far more than the answer is worth.
const PROBE_MAX_BYTES = 60 * 1024 * 1024;

type Row = {
  id: string; tenant_id: string; firm: string; source: string; kind: string;
  file_name: string; file_key: string; file_size_bytes: number | null; status: string;
};

async function main() {
  const nameCol = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT column_name FROM information_schema.columns
      WHERE table_name='tenants' AND column_name IN ('name','firm_name','display_name') LIMIT 1`);
    return (r.rows[0] as any)?.column_name ?? "id";
  });

  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT i.id, i.tenant_id, t.${sql.raw(nameCol)} AS firm, i.source, i.kind,
             i.file_name, i.file_key, i.file_size_bytes, i.status
      FROM rta_file_imports i JOIN tenants t ON t.id = i.tenant_id
      WHERE i.deleted_at IS NULL AND i.file_key IS NOT NULL AND i.status <> 'completed'
      ORDER BY t.${sql.raw(nameCol)}, i.created_at`);
    return r.rows as unknown as Row[];
  });
  console.log(`Probing ${rows.length} retained file(s)…\n`);

  const pwCache = new Map<string, string[]>();
  const pwFor = async (tenantId: string, source: string) => {
    const key = `${tenantId}:${source}`;
    if (!pwCache.has(key)) {
      const cfg = await withTenant(tenantId, async (tx) => getMailbackPasswords(tx, tenantId));
      pwCache.set(key, passwordCandidates(cfg, source).map((e) => e.password));
    }
    return pwCache.get(key)!;
  };

  const openable: Row[] = [];
  const tally = new Map<string, { opens: number; no: number; gone: number; skipped: number }>();
  const bump = (firm: string, k: "opens" | "no" | "gone" | "skipped") => {
    if (!tally.has(firm)) tally.set(firm, { opens: 0, no: 0, gone: 0, skipped: 0 });
    tally.get(firm)![k]++;
  };

  for (const r of rows) {
    let buf: Buffer;
    try { buf = await getObjectBytes(r.file_key); }
    catch { bump(r.firm, "gone"); continue; }

    const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (!isZip) { openable.push(r); bump(r.firm, "opens"); continue; } // plain file, no password needed
    if (buf.length > PROBE_MAX_BYTES) { bump(r.firm, "skipped"); continue; }

    const passwords = await pwFor(r.tenant_id, r.source);
    let ok = false;
    for (const pw of passwords.length ? passwords : [undefined]) {
      try { await extractRtaFileFromZip(new Uint8Array(buf), pw); ok = true; break; } catch { /* next */ }
    }
    if (ok) { openable.push(r); bump(r.firm, "opens"); } else bump(r.firm, "no");
  }

  console.log("=== PROBE RESULT (per firm) ===");
  for (const [firm, t] of tally)
    console.log(`  ${firm.padEnd(28)} opens:${String(t.opens).padStart(4)}  wrong-pw:${String(t.no).padStart(4)}  purged:${String(t.gone).padStart(4)}  too-big:${t.skipped}`);
  console.log(`\nTotal now openable: ${openable.length}`);
  const byStatus = new Map<string, number>();
  for (const r of openable) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  for (const [s, n] of byStatus) console.log(`   ${n} currently marked "${s}"`);

  if (!COMMIT) { console.log("\n(dry run — nothing queued. Re-run with --commit)"); return; }

  // Masters first: a transaction feed whose folios aren't in the client master
  // yet skips every row, so ordering decides whether this run actually lands data.
  openable.sort((a, b) => (RICH.has(b.kind) ? 1 : 0) - (RICH.has(a.kind) ? 1 : 0));

  let queued = 0;
  for (const r of openable) {
    const passwords = await pwFor(r.tenant_id, r.source);
    await withTenant(r.tenant_id, async (tx) => {
      await tx.execute(sql`UPDATE rta_file_imports
        SET status = ${"uploaded"}, remarks = ${"Re-queued after mailback password update"}, parsed_at = NULL
        WHERE id = ${r.id}::uuid`);
    });
    const opts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
    if (RICH.has(r.kind)) {
      await Q.rtaImport().add("rich-import", {
        mode: "rich", importId: r.id, tenantId: r.tenant_id, key: r.file_key, filename: r.file_name,
        passwords, rta: r.source, reportType: "", dryRun: false, assignToMe: false,
        userId: SYSTEM_USER, roles: [],
      }, opts);
    } else {
      await Q.rtaImport().add("import", {
        importId: r.id, tenantId: r.tenant_id, source: r.source, kind: r.kind,
        key: r.file_key, filename: r.file_name, passwords, userId: SYSTEM_USER, roles: [],
      }, opts);
    }
    queued++;
  }
  console.log(`\nQueued ${queued} file(s) — masters first.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.stack ?? e).slice(0, 800)); process.exit(1); });
