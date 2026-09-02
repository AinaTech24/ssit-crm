/**
 * Try a CANDIDATE password against every retained RTA file, alongside the one
 * currently saved, and report which files each opens.
 *
 * A firm can have more than one mailback subscription, each registered with its
 * own ZIP password, so "the password is wrong" is often really "these files
 * belong to the other subscription". This tells the two apart before anything is
 * changed — it never writes the candidate anywhere.
 *
 * The candidate is read from the TEST_PW environment variable (not argv, and
 * never echoed) so it does not linger in shell history or process listings.
 *
 *   TEST_PW=... npx tsx scripts/try-rta-password.ts [cams|kfintech]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getObjectBytes } from "@/lib/storage/s3";
import { getMailbackPasswords } from "@/lib/rta/mailback-config";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";

const SOURCE = process.argv[2] ?? "cams";
const CANDIDATE = process.env.TEST_PW ?? "";

async function opens(buf: Buffer, pw?: string): Promise<boolean> {
  try {
    await extractRtaFileFromZip(new Uint8Array(buf), pw);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!CANDIDATE) {
    console.error("Set TEST_PW to the candidate password.");
    process.exit(1);
  }

  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, tenant_id, kind, file_name, file_key, file_size_bytes, created_at
      FROM rta_file_imports
      WHERE source = ${SOURCE} AND deleted_at IS NULL AND file_key IS NOT NULL
      ORDER BY created_at DESC LIMIT 60`);
    return r.rows as any[];
  });

  let savedOnly = 0;
  let candidateOnly = 0;
  let both = 0;
  let neither = 0;
  let purged = 0;

  for (const r of rows) {
    const pw = await withTenant(r.tenant_id, async (tx) => getMailbackPasswords(tx, r.tenant_id));
    const saved = (SOURCE === "cams" ? pw.camsPassword : pw.kfintechPassword) || undefined;

    let buf: Buffer;
    try {
      buf = await getObjectBytes(r.file_key);
    } catch {
      purged++;
      continue;
    }

    const bySaved = await opens(buf, saved);
    const byCandidate = await opens(buf, CANDIDATE);
    const when = String(r.created_at).slice(4, 20);
    const label = `${when}  ${r.kind.padEnd(23)} ${String(r.file_size_bytes).padStart(9)}b`;

    if (bySaved && byCandidate) {
      both++;
      console.log(`  BOTH       ${label}`);
    } else if (bySaved) {
      savedOnly++;
      console.log(`  SAVED-ONLY ${label}`);
    } else if (byCandidate) {
      candidateOnly++;
      console.log(`  CANDIDATE  ${label}   <-- opens ONLY with the new password`);
    } else {
      neither++;
      console.log(`  NEITHER    ${label}`);
    }
  }

  console.log(`\n=== ${SOURCE.toUpperCase()} RESULT ===`);
  console.log(`  opens with BOTH passwords     : ${both}`);
  console.log(`  opens with the SAVED one only : ${savedOnly}`);
  console.log(`  opens with the CANDIDATE only : ${candidateOnly}`);
  console.log(`  opens with neither            : ${neither}`);
  console.log(`  already purged                : ${purged}`);

  if (candidateOnly > 0 && savedOnly > 0) {
    console.log(`\n  → TWO streams: each password opens a different set.`);
    console.log(`    Replacing the saved one would BREAK the ${savedOnly} it currently opens.`);
    console.log(`    Needs per-file password fallback, or unsubscribe one stream.`);
  } else if (candidateOnly > 0 && savedOnly === 0) {
    console.log(`\n  → The candidate is strictly better. Safe to replace the saved password.`);
  } else if (candidateOnly === 0) {
    console.log(`\n  → The candidate opens nothing the saved one does not. No change needed.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e).slice(0, 300));
    process.exit(1);
  });
