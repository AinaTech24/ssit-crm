/**
 * Dump the header row + first data rows of every RTA file that OPENS with the
 * firm's saved password, and show whether the parser recognises it.
 *
 * Answers the question the import log cannot: when a file unzips fine but fails
 * with "header did not match any known report", WHICH columns did the registrar
 * actually send? That is what a parser signature has to be written against.
 *
 * Read-only.
 *   npx tsx scripts/dump-rta-header.ts [cams|kfintech]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getObjectBytes } from "@/lib/storage/s3";
import { getMailbackPasswords } from "@/lib/rta/mailback-config";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { decodeRtaToText } from "@/lib/rta/decode";

const SOURCE = process.argv[2] ?? "cams";

async function main() {
  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, tenant_id, kind, file_name, file_key, file_size_bytes, created_at, left(coalesce(remarks,''), 60) AS rem
      FROM rta_file_imports
      WHERE source = ${SOURCE} AND deleted_at IS NULL AND file_key IS NOT NULL
        AND created_at > now() - ${"3 days"}::interval
      ORDER BY created_at DESC LIMIT 25`);
    return r.rows as any[];
  });

  for (const r of rows) {
    const pw = await withTenant(r.tenant_id, async (tx) => getMailbackPasswords(tx, r.tenant_id));
    const password = (SOURCE === "cams" ? pw.camsPassword : pw.kfintechPassword) || undefined;
    let buf: Buffer;
    try {
      buf = await getObjectBytes(r.file_key);
    } catch {
      continue; // purged
    }
    // Only ZIPs need unzipping — KFintech link-downloads arrive as plain files.
    const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
    let bytes: Buffer = buf;
    let name = String(r.file_name);
    if (isZip) {
      let inner: any;
      try {
        inner = await extractRtaFileFromZip(new Uint8Array(buf), password);
      } catch {
        continue; // different password — not our concern here
      }
      // extractRtaFileFromZip returns a Uint8Array. It MUST be wrapped in a
      // Buffer: Uint8Array.prototype.toString() ignores its argument and returns
      // comma-joined byte values, so decoding it yields "39,70,79,…" not text.
      const raw = inner?.data ?? inner?.bytes ?? inner?.content;
      bytes = raw ? Buffer.from(raw) : Buffer.alloc(0);
      name = String(inner?.filename ?? r.file_name);
    }
    console.log("=".repeat(78));
    console.log(`${r.kind}  |  ${name}  |  ${bytes.length} bytes  |  ${String(r.created_at).slice(4, 24)}`);
    console.log(`import said: ${r.rem}`);
    let text = "";
    try {
      text = decodeRtaToText(bytes, name);
    } catch (e: any) {
      console.log("  decode refused:", String(e?.message).slice(0, 90));
      continue;
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    console.log(`  lines: ${lines.length}`);
    lines.slice(0, 4).forEach((l, i) => console.log(`  [${i}] ${l.slice(0, 220)}`));
    if (lines.length > 4) console.log(`  … ${lines.length - 4} more`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e).slice(0, 400));
    process.exit(1);
  });
