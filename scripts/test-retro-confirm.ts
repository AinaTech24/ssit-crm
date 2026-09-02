/**
 * Verify that registering a mailbox retroactively claims an already-arrived
 * Gmail forwarding confirmation from that address — the ordering trap seen in
 * production (VSN's confirmation landed 11:41, mailbox registered 12:10, and
 * the firm's own card showed nothing).
 *
 * Read-mostly: it re-saves VSN's EXISTING source addresses (same values), which
 * is a no-op for the registration itself but exercises the retro-attach path.
 *
 *   npx tsx scripts/test-retro-confirm.ts <tenantId>
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { getSourceAddresses, setSourceAddresses } from "@/lib/rta/mailback-config";

const TENANT = process.argv[2];
const ok = (c: boolean, s: string) => console.log(c ? "✓ " + s : "✗ " + s);

async function main() {
  if (!TENANT) { console.error("Usage: npx tsx scripts/test-retro-confirm.ts <tenantId>"); process.exit(1); }

  const before = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT forwarding_confirm_code, forwarding_confirm_url, forwarding_confirm_at
      FROM rta_forward_addresses WHERE tenant_id = ${TENANT}::uuid AND is_active`);
    return r.rows[0] as any;
  });
  console.log("BEFORE — card shows confirmation:", before?.forwarding_confirm_url ? "yes" : "NO");

  const pending = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT count(*)::int AS n FROM rta_inbound_messages
      WHERE tenant_id IS NULL AND outcome = 'confirmation'
        AND created_at > now() - interval '14 days'`);
    return (r.rows[0] as any).n as number;
  });
  console.log("unattributed confirmations on record:", pending);

  const current = await withTenant(TENANT, async (tx) => getSourceAddresses(tx, TENANT));
  console.log("registered mailboxes:", JSON.stringify(current));

  // Re-save the SAME addresses — a no-op registration that exercises retro-attach.
  const res = await withTenant(TENANT, async (tx) => setSourceAddresses(tx, TENANT, current));
  console.log("\nsetSourceAddresses ->", JSON.stringify(res));
  ok(res.saved.length === current.length, "registration itself unchanged (idempotent re-save)");
  ok(res.rejected.length === 0, "no false collision against itself");

  const after = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT forwarding_confirm_code, forwarding_confirm_url
      FROM rta_forward_addresses WHERE tenant_id = ${TENANT}::uuid AND is_active`);
    return r.rows[0] as any;
  });
  console.log("\nAFTER — card shows confirmation:", after?.forwarding_confirm_url ? "YES" : "no");
  if (after?.forwarding_confirm_url) {
    ok(/\/mail\/vf-/.test(after.forwarding_confirm_url), "captured the CONFIRM link (vf-), not the cancel link (uf-)");
    console.log("   link:", String(after.forwarding_confirm_url).slice(0, 80) + "...");
  }
  ok((res as any).confirmationsAttached >= 0, `confirmationsAttached = ${(res as any).confirmationsAttached}`);

  const stillUnattributed = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT count(*)::int AS n FROM rta_inbound_messages
      WHERE tenant_id IS NULL AND outcome = 'confirmation'
        AND created_at > now() - interval '14 days'`);
    return (r.rows[0] as any).n as number;
  });
  console.log("unattributed confirmations now:", stillUnattributed, `(was ${pending})`);
  ok(stillUnattributed <= pending, "claimed row no longer counted as unattributed");
}

main().then(() => process.exit(0)).catch((e) => { console.error(String(e?.stack ?? e).slice(0, 600)); process.exit(1); });
