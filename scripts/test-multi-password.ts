/**
 * End-to-end test of the multi-password unzip retry + classification, against
 * real S3 + Postgres AND a real tenant/folio so a successful unzip produces a
 * genuine `completed` row (not "skipped — folio not in client master", which
 * a synthetic folio number would trigger and muddy the signal).
 *
 * Creates and cleans up its own throwaway rta_file_imports + transactions
 * rows; never touches real client data (the transaction it inserts is deleted
 * again at the end, matched by a distinctive external ref).
 *
 *   npx tsx scripts/test-multi-password.ts <tenantId>
 */
import "dotenv/config";
import { withSystem, withTenant } from "@/db/client";
import { sql } from "drizzle-orm";
import { runRtaImportJob } from "@/workers/rta-import-worker";
import { putObject, deleteObject } from "@/lib/storage/s3";
import { ZipWriter, BlobWriter, TextReader } from "@zip.js/zip.js";

const ok = (c: boolean, s: string) => console.log(c ? "✓ " + s : "✗ " + s);
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
const TENANT = process.argv[2];
const REF_TAG = "MULTIPWTEST"; // marks rows this script creates, for cleanup

async function makeZip(csv: string, password?: string): Promise<Buffer> {
  const bw = new BlobWriter("application/zip");
  const zw = new ZipWriter(bw, password ? { password, encryptionStrength: 3 } : {});
  await zw.add("R2.csv", new TextReader(csv));
  await zw.close();
  return Buffer.from(await (await bw.getData()).arrayBuffer());
}

async function main() {
  if (!TENANT) {
    console.error("Usage: npx tsx scripts/test-multi-password.ts <tenantId>");
    process.exit(1);
  }

  // A REAL folio + AMC code from this tenant, so the row actually imports
  // instead of being skipped as "not in client master" (which would make
  // status='failed' regardless of whether the password logic worked).
  const folio = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT folio_number, amc_code FROM folios
      WHERE tenant_id = ${TENANT} AND folio_number IS NOT NULL AND amc_code IS NOT NULL
      LIMIT 1`);
    return r.rows[0] as any;
  });
  if (!folio) {
    console.error("This tenant has no folios to test against — pick a tenant with real data.");
    process.exit(1);
  }
  console.log(`Using real folio ${folio.folio_number} (${folio.amc_code}) from tenant ${TENANT}\n`);

  const csv =
    "AMC_CODE,FOLIO_NO,SCHEME,TRXNTYPE,TRXNNO,TRADDATE,POSTDATE,UNITS,AMOUNT\n" +
    `${folio.amc_code},${folio.folio_number},Test Scheme,R1,${REF_TAG}1,01-08-2026,01-08-2026,1,100\n`;

  const mkImport = async () => {
    const r = await withTenant(TENANT, async (tx) =>
      tx.execute(sql`
        INSERT INTO rta_file_imports (tenant_id,source,kind,period_start,period_end,file_name,file_key,file_size_bytes,file_checksum,status,remarks)
        VALUES (${TENANT}::uuid,'cams','daily_transaction_feed',current_date,current_date,${REF_TAG + ".zip"},'k','0',md5(random()::text),'uploaded',${REF_TAG})
        RETURNING id`)
    );
    return (r.rows[0] as any).id as string;
  };
  const getRow = async (id: string) => {
    const r = await withSystem(async (tx) => tx.execute(sql`SELECT status, remarks, rows_imported, rows_skipped FROM rta_file_imports WHERE id=${id}::uuid`));
    return r.rows[0] as any;
  };

  const cleanupKeys: string[] = [];
  const cleanupImportIds: string[] = [];

  try {
    const zipRight = await makeZip(csv, "Cams@123");

    // CASE 1: exactly one saved password, and it's THE RIGHT one -> completed, 1 row imported.
    let id = await mkImport();
    cleanupImportIds.push(id);
    let key = `test/multi-pw-${id}.zip`;
    cleanupKeys.push(key);
    await putObject(key, zipRight, "application/zip");
    await runRtaImportJob({
      importId: id, tenantId: TENANT, source: "cams", kind: "daily_transaction_feed",
      key, filename: "t.zip", passwords: ["Cams@123"], userId: SYSTEM_USER, roles: [],
    });
    let row = await getRow(id);
    ok(row.status === "completed" && row.rows_imported === 1, `single correct password -> ${row.status}, imported=${row.rows_imported}`);

    // CASE 2: TWO saved passwords, file only opens with the SECOND -> completed.
    // The multi-ARN scenario: a second subscription's password recovers data
    // that would otherwise be silently dismissed as "not ours".
    id = await mkImport();
    cleanupImportIds.push(id);
    key = `test/multi-pw-${id}.zip`;
    cleanupKeys.push(key);
    await putObject(key, zipRight, "application/zip");
    await runRtaImportJob({
      importId: id, tenantId: TENANT, source: "cams", kind: "daily_transaction_feed",
      key, filename: "t.zip", passwords: ["WrongOne@1", "Cams@123"], userId: SYSTEM_USER, roles: [],
    });
    row = await getRow(id);
    ok(row.status === "completed" && row.rows_imported === 1, `2nd of 2 saved passwords opens it -> ${row.status}, imported=${row.rows_imported} (THE MULTI-ARN CASE)`);

    // CASE 3: file belongs to NEITHER saved password -> rejected, message names the count.
    id = await mkImport();
    cleanupImportIds.push(id);
    const zipOther = await makeZip(csv, "SomeoneElses@1");
    key = `test/multi-pw-${id}.zip`;
    cleanupKeys.push(key);
    await putObject(key, zipOther, "application/zip");
    await runRtaImportJob({
      importId: id, tenantId: TENANT, source: "cams", kind: "daily_transaction_feed",
      key, filename: "t.zip", passwords: ["A@1", "B@2"], userId: SYSTEM_USER, roles: [],
    });
    row = await getRow(id);
    ok(row.status === "rejected", `wrong-for-both saved passwords -> ${row.status}`);
    ok(/none of the 2 saved passwords/i.test(row.remarks), "message states the count: " + row.remarks);

    // CASE 4: NO password saved at all, file IS encrypted -> stays FAILED,
    // never silently dismissed as "not ours" (we can't claim it isn't ours if
    // we never had anything to compare against).
    id = await mkImport();
    cleanupImportIds.push(id);
    key = `test/multi-pw-${id}.zip`;
    cleanupKeys.push(key);
    await putObject(key, zipOther, "application/zip");
    await runRtaImportJob({
      importId: id, tenantId: TENANT, source: "cams", kind: "daily_transaction_feed",
      key, filename: "t.zip", passwords: [], userId: SYSTEM_USER, roles: [],
    });
    row = await getRow(id);
    ok(row.status === "failed", `zero saved passwords + encrypted file -> ${row.status} (must stay FAILED)`);

    // CASE 5: the deprecated singular `password` field is still honoured, for
    // any job already queued at the moment of deploy.
    id = await mkImport();
    cleanupImportIds.push(id);
    key = `test/multi-pw-${id}.zip`;
    cleanupKeys.push(key);
    await putObject(key, zipRight, "application/zip");
    await runRtaImportJob({
      importId: id, tenantId: TENANT, source: "cams", kind: "daily_transaction_feed",
      key, filename: "t.zip", password: "Cams@123", userId: SYSTEM_USER, roles: [],
    } as any);
    row = await getRow(id);
    ok(row.status === "completed" && row.rows_imported === 1, `deprecated singular 'password' field still honoured -> ${row.status}, imported=${row.rows_imported}`);
  } finally {
    for (const k of cleanupKeys) await deleteObject(k).catch(() => {});
    // Delete the transaction this test upserted (matched by order_id — the
    // processor upserts ON CONFLICT (tenant_id, order_id), so every run of
    // this script converges on the SAME row rather than piling up dupes).
    await withTenant(TENANT!, async (tx) => {
      await tx.execute(sql`DELETE FROM transactions WHERE tenant_id = ${TENANT}::uuid AND order_id = ${REF_TAG + "1"}`);
    }).catch(() => {});
    for (const id of cleanupImportIds) {
      await withSystem(async (tx) => {
        await tx.execute(sql`DELETE FROM rta_file_imports WHERE id = ${id}::uuid`);
      }).catch(() => {});
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e?.stack ?? e).slice(0, 800));
    process.exit(1);
  });
