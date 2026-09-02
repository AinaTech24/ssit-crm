/**
 * One-off diagnostic for RTA import failures: prints the full text of the most
 * recent database-level error, then re-tests the stored ZIP password against the
 * most recent "Invalid password" file still held in S3.
 *
 * Only possible because failed imports now RETAIN their source file (previously
 * it was purged on failure, so a credential could never be re-tested).
 *
 *   npx tsx scripts/diagnose-rta-failures.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getObjectBytes } from "@/lib/storage/s3";
import { getMailbackPasswords } from "@/lib/rta/mailback-config";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";

async function main() {
  const err = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT left(remarks, 800) AS rem, source, kind
      FROM rta_file_imports
      WHERE remarks LIKE ${"Failed query%"} AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`);
    return r.rows as any[];
  });
  console.log("=== DB-ERROR REMARK (full) ===");
  console.log(err[0] ? `${err[0].source}/${err[0].kind}\n${err[0].rem}` : "(none)");

  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, tenant_id, source, file_key, file_name, file_size_bytes
      FROM rta_file_imports
      WHERE remarks LIKE ${"%Invalid password%"} AND deleted_at IS NULL
        AND created_at > now() - ${"12 hours"}::interval
      ORDER BY created_at DESC LIMIT 1`);
    return r.rows as any[];
  });
  if (!rows.length) {
    console.log("\n(no recent password failure to test)");
    return;
  }

  const r = rows[0];
  const pw = await withTenant(r.tenant_id, async (tx) => getMailbackPasswords(tx, r.tenant_id));
  console.log("\n=== PASSWORD RE-TEST against the newest failing file ===");
  console.log("file :", String(r.file_name).slice(0, 50), "|", r.file_size_bytes, "bytes");
  console.log("saved CAMS password:", pw.camsPassword ? `${pw.camsPassword.length} chars` : "NONE SAVED");

  let buf: Buffer;
  try {
    buf = await getObjectBytes(r.file_key);
  } catch (e: any) {
    console.log("  S3: GONE —", String(e?.message).slice(0, 70));
    return;
  }
  console.log("  S3: PRESENT", buf.length, "bytes (retained by the keep-on-failure fix)");

  try {
    const out: any = await extractRtaFileFromZip(new Uint8Array(buf), pw.camsPassword || undefined);
    console.log("  *** UNZIP OK — the saved password IS correct ***  inner:", out?.filename);
  } catch (e: any) {
    console.log("  *** UNZIP FAILED —", e?.message, "***");
    // Distinguish "wrong password" from "not actually encrypted / corrupt".
    try {
      const out: any = await extractRtaFileFromZip(new Uint8Array(buf), undefined);
      console.log("  NOTE: opens with NO password — this zip is not encrypted. inner:", out?.filename);
    } catch (e2: any) {
      console.log("  Also fails with no password:", String(e2?.message).slice(0, 70));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e).slice(0, 400));
    process.exit(1);
  });
