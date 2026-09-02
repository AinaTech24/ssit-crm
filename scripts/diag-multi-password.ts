/**
 * Step-by-step diagnostic for the multi-password test failures: isolates
 * zip creation, S3 round-trip, unzip, and the full job — printing state after
 * each step instead of only checking the final DB row.
 *
 *   npx tsx scripts/diag-multi-password.ts
 */
import "dotenv/config";
import { withSystem, withTenant } from "@/db/client";
import { sql } from "drizzle-orm";
import { runRtaImportJob } from "@/workers/rta-import-worker";
import { putObject, deleteObject, getObjectBytes } from "@/lib/storage/s3";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { ZipWriter, BlobWriter, TextReader } from "@zip.js/zip.js";

const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

async function makeZip(password?: string): Promise<Buffer> {
  const bw = new BlobWriter("application/zip");
  const zw = new ZipWriter(bw, password ? { password, encryptionStrength: 3 } : {});
  await zw.add("R2.csv", new TextReader("AMC_CODE,FOLIO_NO,SCHEME,TRXNTYPE,UNITS,AMOUNT\nD,123,Test Fund,R1,10,1000\n"));
  await zw.close();
  const blob = await bw.getData();
  return Buffer.from(await blob.arrayBuffer());
}

async function main() {
  const T = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants LIMIT 1`);
    return (r.rows[0] as any).id as string;
  });
  console.log("tenant:", T);

  // Step 1: create + verify the zip decrypts LOCALLY, no S3/DB involved.
  const zip = await makeZip("Cams@123");
  console.log("zip bytes:", zip.length);
  try {
    const r = await extractRtaFileFromZip(new Uint8Array(zip), "Cams@123");
    console.log("✓ local unzip with correct password OK — inner:", r.filename, r.data.length, "bytes");
  } catch (e: any) {
    console.log("✗ local unzip FAILED even with the right password:", e?.message);
    return;
  }

  // Step 2: S3 round-trip — does putObject/getObjectBytes preserve the bytes?
  const key = `test/diag-${Date.now()}.zip`;
  await putObject(key, zip, "application/zip");
  const back = await getObjectBytes(key);
  console.log("S3 round-trip:", back.length, "bytes, identical:", Buffer.compare(zip, back) === 0);
  try {
    const r = await extractRtaFileFromZip(new Uint8Array(back), "Cams@123");
    console.log("✓ unzip of the S3-ROUND-TRIPPED bytes OK — inner:", r.filename);
  } catch (e: any) {
    console.log("✗ unzip of S3-round-tripped bytes FAILED:", e?.message, "(bytes got mangled in transit)");
  }

  // Step 3: the full job, with a DIRECT check on the row right after.
  const importId = await withTenant(T, async (tx) => {
    const r = await tx.execute(sql`
      INSERT INTO rta_file_imports (tenant_id,source,kind,period_start,period_end,file_name,file_key,file_size_bytes,file_checksum,status)
      VALUES (${T}::uuid,'cams','daily_transaction_feed',current_date,current_date,'diag.zip',${key},${zip.length},md5(random()::text),'uploaded')
      RETURNING id`);
    return (r.rows[0] as any).id as string;
  });
  console.log("importId:", importId);

  let thrown: any = null;
  try {
    await runRtaImportJob({
      importId, tenantId: T, source: "cams", kind: "daily_transaction_feed",
      key, filename: "diag.zip", passwords: ["Cams@123"], userId: SYSTEM_USER, roles: [],
    });
  } catch (e) {
    thrown = e;
  }
  console.log("runRtaImportJob threw:", thrown ? String((thrown as any)?.stack ?? thrown).slice(0, 500) : "(nothing — returned normally)");

  const row = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT status, remarks, rows_total, rows_imported, rows_skipped, rows_failed, errors FROM rta_file_imports WHERE id=${importId}::uuid`);
    return r.rows[0] as any;
  });
  console.log("final row:", JSON.stringify(row, null, 2));

  await deleteObject(key).catch(() => {});
  await withSystem(async (tx) => { await tx.execute(sql`DELETE FROM rta_file_imports WHERE id=${importId}::uuid`); });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("TOP-LEVEL:", String(e?.stack ?? e).slice(0, 800));
    process.exit(1);
  });
