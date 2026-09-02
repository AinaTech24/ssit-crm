/**
 * Reproduce the exact "Failed query: UPDATE rta_file_imports SET status..."
 * error seen in the worker log, by running the SAME update with the SAME
 * shape of params directly, to surface the underlying Postgres error the log
 * line truncated.
 *
 *   npx tsx scripts/repro-update-failure.ts <importId>
 */
import "dotenv/config";
import { withSystem, withTenant } from "@/db/client";
import { sql } from "drizzle-orm";

const ID = process.argv[2];

async function main() {
  if (!ID) {
    console.error("Usage: npx tsx scripts/repro-update-failure.ts <importId>");
    process.exit(1);
  }
  const row = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT tenant_id, status, remarks FROM rta_file_imports WHERE id = ${ID}::uuid`);
    return r.rows[0] as any;
  });
  console.log("current row:", JSON.stringify(row));

  const longRemarks =
    "Unrecognised RTA file format — header did not match any known report. First columns: " +
    "FOLIOCHK, INV_NAME, ADDRESS1, ADDRESS2, ADDRESS3, CITY, PINCODE, PRODUCT, SCH_NAME, REP_DATE, " +
    "CLOS_BAL, RUPEE_BAL, JNT_NAME1, JNT_NAME2, PHONE_OFF, PHONE_RES, EMAIL, HOLDING_NA, UIN_NO, PAN_NO, " +
    "JOINT1_PAN, JOINT2_PAN, GUARD_PAN, TAX_STATUS, BROKER_COD, SUBBROKER, REINV_FLAG, BANK_NAME";

  try {
    await withTenant(row.tenant_id, async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports SET status = ${"failed"}, parsed_at = now(),
          remarks = ${longRemarks.slice(0, 1000)}
        WHERE id = ${ID}::uuid
      `);
    });
    console.log("✓ UPDATE succeeded — could not reproduce.");
  } catch (e: any) {
    console.log("✗ REPRODUCED. Full error:");
    console.log("  name   :", e?.name);
    console.log("  message:", e?.message);
    console.log("  cause  :", e?.cause ? JSON.stringify(e.cause, Object.getOwnPropertyNames(e.cause)) : "(none)");
    console.log("  code   :", e?.cause?.code ?? e?.code);
    console.log("  detail :", e?.cause?.detail ?? e?.detail);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("TOP-LEVEL:", String(e?.stack ?? e).slice(0, 500));
    process.exit(1);
  });
