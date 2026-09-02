/**
 * Why is one firm's mailback failing? Per retained file, report whether it is
 * encrypted at all and WHICH of the firm's saved passwords (by index — never
 * the value) opens it.
 *
 * This separates the three causes that all look identical from the outside:
 *   - a password we simply don't have yet (firm has more subscriptions than passwords)
 *   - a genuinely foreign file (another platform's archive sharing the mailbox)
 *   - a non-password failure (corrupt/oversized/unrecognised format)
 *
 *   npx tsx scripts/diagnose-firm-failures.ts <tenantId>
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getObjectBytes } from "@/lib/storage/s3";
import { getMailbackPasswords, passwordCandidates } from "@/lib/rta/mailback-config";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";

const TENANT = process.argv[2];

async function main() {
  if (!TENANT) { console.error("Usage: diagnose-firm-failures.ts <tenantId>"); process.exit(1); }

  const cfg = await withTenant(TENANT, async (tx) => getMailbackPasswords(tx, TENANT));
  const cams = passwordCandidates(cfg, "cams");
  const kfin = passwordCandidates(cfg, "kfintech");
  console.log(`saved passwords — CAMS: ${cams.length} [${cams.map((e) => e.label).join(", ")}]`);
  console.log(`saved passwords — KFintech: ${kfin.length} [${kfin.map((e) => e.label).join(", ")}]\n`);

  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, source, kind, status, file_name, file_key, file_size_bytes, created_at
      FROM rta_file_imports
      WHERE tenant_id = ${TENANT}::uuid AND deleted_at IS NULL AND file_key IS NOT NULL
      ORDER BY created_at DESC LIMIT 200`);
    return r.rows as any[];
  });

  const buckets = new Map<string, number>();
  const openedBy = new Map<string, number>();
  const unknownExamples: string[] = [];

  for (const r of rows) {
    let buf: Buffer;
    try { buf = await getObjectBytes(r.file_key); }
    catch { buckets.set("file purged (already imported)", (buckets.get("file purged (already imported)") ?? 0) + 1); continue; }

    const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (!isZip) { buckets.set("not a zip (plain file)", (buckets.get("not a zip (plain file)") ?? 0) + 1); continue; }

    // Unencrypted?
    try {
      await extractRtaFileFromZip(new Uint8Array(buf), undefined);
      buckets.set("zip, NOT encrypted", (buckets.get("zip, NOT encrypted") ?? 0) + 1);
      continue;
    } catch { /* encrypted — keep going */ }

    const list = r.source === "cams" ? cams : kfin;
    let hit: string | null = null;
    for (let i = 0; i < list.length; i++) {
      try {
        await extractRtaFileFromZip(new Uint8Array(buf), list[i].password);
        hit = `#${i + 1} (${list[i].label})`;
        break;
      } catch { /* try next */ }
    }
    if (hit) {
      const k = `OPENS with ${r.source} password ${hit}`;
      openedBy.set(k, (openedBy.get(k) ?? 0) + 1);
    } else {
      const k = `NO saved ${r.source} password opens it`;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
      if (unknownExamples.length < 6) unknownExamples.push(`${r.source}/${r.kind}  ${String(r.file_name).slice(0, 52)}`);
    }
  }

  console.log(`=== ${rows.length} retained file(s) ===`);
  for (const [k, v] of openedBy) console.log(`  ✅ ${String(v).padStart(3)}  ${k}`);
  for (const [k, v] of buckets) console.log(`  ❌ ${String(v).padStart(3)}  ${k}`);
  if (unknownExamples.length) {
    console.log("\n  examples needing an unknown password:");
    for (const e of unknownExamples) console.log(`     ${e}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.stack ?? e).slice(0, 500)); process.exit(1); });
