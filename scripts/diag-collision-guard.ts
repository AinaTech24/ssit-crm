/**
 * Confirm WHY the source-address collision guard never fires: RLS.
 *
 * setSourceAddresses runs inside withTenant(), so every SELECT it makes is
 * row-level-security scoped to that ONE tenant. Its "is this mailbox already
 * claimed by a DIFFERENT tenant?" query therefore inspects a result set that
 * cannot, by construction, contain another tenant's row — so it always
 * concludes "no collision".
 *
 * This proves it by running the identical query under both contexts.
 *
 *   npx tsx scripts/diag-collision-guard.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";

async function main() {
  const t = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT tenant_id FROM rta_forward_addresses WHERE is_active ORDER BY created_at LIMIT 2`);
    return (r.rows as any[]).map((x) => x.tenant_id as string);
  });
  const [A, B] = t;
  const MAILBOX = "collision-probe@example.test";

  // Plant the mailbox on tenant B, bypassing RLS.
  await withSystem(async (tx) => {
    await tx.execute(sql`
      UPDATE rta_forward_addresses SET source_addresses = ${JSON.stringify([MAILBOX])}::jsonb
      WHERE tenant_id = ${B} AND is_active`);
  });

  try {
    // The exact shape of the guard's query, run as tenant A (i.e. how
    // setSourceAddresses actually runs it).
    const underTenant = await withTenant(A, async (tx) => {
      const r = await tx.execute(sql`
        SELECT tenant_id FROM rta_forward_addresses
        WHERE is_active AND tenant_id <> ${A}
          AND jsonb_exists_any(source_addresses, ARRAY[${MAILBOX}]::text[])`);
      return r.rows.length;
    });

    // Same query with cross-tenant visibility.
    const underSystem = await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT tenant_id FROM rta_forward_addresses
        WHERE is_active AND tenant_id <> ${A}
          AND jsonb_exists_any(source_addresses, ARRAY[${MAILBOX}]::text[])`);
      return r.rows.length;
    });

    console.log(`rows seen as tenant A (withTenant, RLS-scoped): ${underTenant}`);
    console.log(`rows seen with cross-tenant visibility (withSystem): ${underSystem}`);
    console.log(
      underTenant === 0 && underSystem > 0
        ? "\n>>> CONFIRMED: RLS hides the other tenant's row, so the guard can never detect a collision. <<<"
        : "\n>>> Not reproduced as expected — investigate further. <<<"
    );
  } finally {
    await withSystem(async (tx) => {
      await tx.execute(sql`
        UPDATE rta_forward_addresses SET source_addresses = '[]'::jsonb
        WHERE tenant_id = ${B} AND is_active`);
    });
    console.log("cleaned up probe mailbox");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e?.stack ?? e).slice(0, 500));
    process.exit(1);
  });
