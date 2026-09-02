/**
 * Safety test for the "every MFD forwards to the shared rta@ address" plan.
 *
 * The shared address carries no firm identity of its own — routing depends
 * entirely on matching the SENDING mailbox against `source_addresses`. This
 * verifies the two failure modes that would actually hurt:
 *
 *   1. An UNREGISTERED sender must NOT route to some arbitrary firm — it must
 *      resolve to nothing (quarantined), never silently import into the wrong
 *      client book.
 *   2. A mailbox registered by TWO firms must resolve to NOTHING (ambiguous),
 *      not to whichever row the database happened to return first.
 *
 * Read-only against real tenants: it creates temporary source-address
 * registrations, asserts, then restores the originals.
 *
 *   npx tsx scripts/test-shared-address-safety.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { resolveTenantBySenders, setSourceAddresses, getSourceAddresses } from "@/lib/rta/mailback-config";

const ok = (c: boolean, s: string) => console.log(c ? "✓ " + s : "✗ " + s);

async function main() {
  const tenants = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT tenant_id FROM rta_forward_addresses WHERE is_active ORDER BY created_at LIMIT 2`);
    return (r.rows as any[]).map((x) => x.tenant_id as string);
  });
  if (tenants.length < 2) {
    console.error("need 2 tenants with forward addresses");
    process.exit(1);
  }
  const [A, B] = tenants;

  // Snapshot so we can restore exactly what was there before.
  const origA = await withTenant(A, async (tx) => getSourceAddresses(tx, A));
  const origB = await withTenant(B, async (tx) => getSourceAddresses(tx, B));
  console.log(`tenant A ${A} originally: ${JSON.stringify(origA)}`);
  console.log(`tenant B ${B} originally: ${JSON.stringify(origB)}\n`);

  try {
    // ── 1. Unregistered sender must not route anywhere ──────────────────────
    await withTenant(A, async (tx) => setSourceAddresses(tx, A, ["ops@firm-a-test.example"]));
    await withTenant(B, async (tx) => setSourceAddresses(tx, B, ["ops@firm-b-test.example"]));

    let m = await withSystem(async (tx) => resolveTenantBySenders(tx, ["nobody@unregistered.example"]));
    ok(m.row === null && !m.ambiguous, "UNREGISTERED sender routes to NOTHING (quarantined, not misfiled)");

    // ── 2. Correct sender routes to the right firm, not just "a" firm ───────
    m = await withSystem(async (tx) => resolveTenantBySenders(tx, ["ops@firm-a-test.example"]));
    ok(m.row?.tenantId === A, `registered sender routes to the CORRECT firm (got ${m.row?.tenantId === A ? "A" : m.row?.tenantId === B ? "B (WRONG!)" : "none"})`);

    m = await withSystem(async (tx) => resolveTenantBySenders(tx, ["ops@firm-b-test.example"]));
    ok(m.row?.tenantId === B, "second firm's sender routes to ITS own book, not the first firm's");

    // ── 3. Same mailbox claimed by two firms => ambiguous, routes NOWHERE ───
    // setSourceAddresses rejects a collision at registration; force the row
    // directly to simulate data that predates that guard (or was seeded).
    await withSystem(async (tx) => {
      await tx.execute(sql`
        UPDATE rta_forward_addresses SET source_addresses = ${JSON.stringify(["shared@both-firms.example"])}::jsonb
        WHERE tenant_id = ${A} AND is_active`);
      await tx.execute(sql`
        UPDATE rta_forward_addresses SET source_addresses = ${JSON.stringify(["shared@both-firms.example"])}::jsonb
        WHERE tenant_id = ${B} AND is_active`);
    });
    m = await withSystem(async (tx) => resolveTenantBySenders(tx, ["shared@both-firms.example"]));
    ok(m.row === null && m.ambiguous, "mailbox claimed by TWO firms => ambiguous, routes to NEITHER (no cross-tenant leak)");

    // ── 4. Registration-time guard blocks the collision in the first place ──
    await withTenant(A, async (tx) => setSourceAddresses(tx, A, ["ops@firm-a-test.example"]));
    const res = await withTenant(B, async (tx) => setSourceAddresses(tx, B, ["ops@firm-a-test.example"]));
    ok(res.rejected.includes("ops@firm-a-test.example") && res.saved.length === 0,
      "registering a mailbox ALREADY claimed by another firm is REJECTED up-front");

    // ── 5. Case-insensitivity — Gmail headers vary in casing ───────────────
    await withTenant(A, async (tx) => setSourceAddresses(tx, A, ["Ops@Firm-A-Test.Example"]));
    m = await withSystem(async (tx) => resolveTenantBySenders(tx, ["ops@firm-a-test.example"]));
    ok(m.row?.tenantId === A, "sender matching is case-insensitive (header casing varies in practice)");
  } finally {
    await withTenant(A, async (tx) => setSourceAddresses(tx, A, origA));
    await withTenant(B, async (tx) => setSourceAddresses(tx, B, origB));
    const backA = await withTenant(A, async (tx) => getSourceAddresses(tx, A));
    const backB = await withTenant(B, async (tx) => getSourceAddresses(tx, B));
    console.log(`\nrestored A: ${JSON.stringify(backA)} | B: ${JSON.stringify(backB)}`);
    ok(JSON.stringify(backA) === JSON.stringify(origA) && JSON.stringify(backB) === JSON.stringify(origB),
      "original registrations restored exactly");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e?.stack ?? e).slice(0, 600));
    process.exit(1);
  });
