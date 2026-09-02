/**
 * Try the firm's SAVED CAMS password against every CAMS file we still hold in S3.
 *
 * Registrars can encrypt different report streams with different passwords (and a
 * firm may have several mailback subscriptions set up at different times). This
 * separates "the saved password is wrong" from "these particular reports use a
 * different password" — which the per-file failure message alone cannot tell you.
 *
 * Read-only: opens the archives in memory, imports nothing, deletes nothing.
 *
 *   npx tsx scripts/test-cams-password-all.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getObjectBytes } from "@/lib/storage/s3";
import { getMailbackPasswords } from "@/lib/rta/mailback-config";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";

type Row = {
  id: string;
  tenant_id: string;
  source: string;
  kind: string;
  file_name: string;
  file_key: string;
  file_size_bytes: number | null;
  created_at: string;
  remarks: string | null;
};

const SOURCE = process.argv[2] ?? "cams";

async function main() {
  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, tenant_id, source, kind, file_name, file_key, file_size_bytes, created_at, remarks
      FROM rta_file_imports
      WHERE source = ${SOURCE} AND deleted_at IS NULL AND file_key IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 60`);
    return r.rows as unknown as Row[];
  });
  console.log(`${SOURCE.toUpperCase()} rows on record: ${rows.length}\n`);

  const pwCache = new Map<string, any>();
  const pwFor = async (t: string) => {
    if (!pwCache.has(t)) pwCache.set(t, await withTenant(t, async (tx) => getMailbackPasswords(tx, t)));
    return pwCache.get(t);
  };

  let opened = 0;
  let wrongPw = 0;
  let gone = 0;
  let other = 0;
  const openedKinds = new Set<string>();
  const failedKinds = new Set<string>();

  for (const r of rows) {
    const pw = await pwFor(r.tenant_id);
    const password = (r.source === "cams" ? pw.camsPassword : pw.kfintechPassword) || undefined;
    const when = String(r.created_at).slice(4, 24);
    const label = `${when} ${r.kind.padEnd(24)} ${String(r.file_size_bytes ?? 0).padStart(9)}b`;

    let buf: Buffer;
    try {
      buf = await getObjectBytes(r.file_key);
    } catch {
      gone++;
      console.log(`  PURGED   ${label}  (file no longer in S3)`);
      continue;
    }

    try {
      const out: any = await extractRtaFileFromZip(new Uint8Array(buf), password);
      opened++;
      openedKinds.add(r.kind);
      console.log(`  OPENS ✓  ${label}  inner: ${String(out?.filename ?? "?").slice(0, 40)}`);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (/password/i.test(msg)) {
        wrongPw++;
        failedKinds.add(r.kind);
        console.log(`  WRONG-PW ${label}  ${msg.slice(0, 40)}`);
      } else {
        other++;
        console.log(`  OTHER    ${label}  ${msg.slice(0, 55)}`);
      }
    }
  }

  console.log(`\n=== SUMMARY (saved ${SOURCE} password) ===`);
  console.log(`  opens with saved password : ${opened}`);
  console.log(`  rejects the password      : ${wrongPw}`);
  console.log(`  file already purged       : ${gone}`);
  console.log(`  other error               : ${other}`);
  if (openedKinds.size) console.log(`  kinds that OPEN   : ${[...openedKinds].join(", ")}`);
  if (failedKinds.size) console.log(`  kinds that REJECT : ${[...failedKinds].join(", ")}`);
  if (opened && wrongPw) {
    console.log(`\n  → Mixed result: the saved password is VALID, but some report streams`);
    console.log(`    are encrypted with a different one. Those need their own password`);
    console.log(`    (or should be unsubscribed if not needed).`);
  } else if (!opened && wrongPw) {
    console.log(`\n  → No file opens: the saved password does not match ANY current file.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e).slice(0, 400));
    process.exit(1);
  });
