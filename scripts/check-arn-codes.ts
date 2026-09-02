/**
 * Scan this tenant's recent inbound RTA mail for ARN / Broker Code mentions.
 * If more than one shows up, the firm likely runs multiple ARN-registered
 * mailback subscriptions — which changes how password mismatches should be
 * classified (see rta-import-worker.ts markRejected / NOT_OUR_FILE).
 *
 *   npx tsx scripts/check-arn-codes.ts <tenantId>
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

const TENANT = process.argv[2];

async function main() {
  if (!TENANT) {
    console.error("Usage: npx tsx scripts/check-arn-codes.ts <tenantId>");
    process.exit(1);
  }
  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, created_at, outcome, subject, body_snippet
      FROM rta_inbound_messages
      WHERE tenant_id = ${TENANT} AND body_snippet IS NOT NULL
      ORDER BY created_at DESC LIMIT 80`);
    return r.rows as any[];
  });

  const arns = new Map<string, { n: number; sample: string[]; outcomes: Set<string> }>();
  for (const r of rows) {
    const matches = String(r.body_snippet ?? "").match(/ARN[-\s]?\d{3,6}/gi) ?? [];
    for (const raw of matches) {
      const key = raw.toUpperCase().replace(/\s+/, "-");
      const entry = arns.get(key) ?? { n: 0, sample: [], outcomes: new Set() };
      entry.n++;
      entry.outcomes.add(r.outcome);
      if (entry.sample.length < 2) entry.sample.push(`${String(r.created_at).slice(4, 20)} | ${String(r.subject).slice(0, 55)}`);
      arns.set(key, entry);
    }
  }

  console.log(`Scanned ${rows.length} inbound message(s) with body text.\n`);
  if (!arns.size) {
    console.log("No ARN/Broker Code found in any body snippet.");
    return;
  }
  console.log(`Distinct ARN/Broker codes seen: ${arns.size}`);
  for (const [k, v] of arns) {
    console.log(`  ${k}  — seen ${v.n}x  — outcomes: ${[...v.outcomes].join(", ")}`);
    v.sample.forEach((s) => console.log(`      ${s}`));
  }
  if (arns.size > 1) {
    console.log("\n>>> MULTIPLE ARNs detected for this tenant. <<<");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 300));
    process.exit(1);
  });
