/**
 * Keeps "Referred by" in step with the Referrals box.
 *
 * Adding Y under Referrals on client X means X referred Y - so Y's own "Referred by" must list X, without anyone
 * typing it twice. Removing Y from X's referrals takes X off Y's list again. A referral that is an open LEAD gets
 * X as its referrer when it has none.
 *
 * Which record a referral entry is: the one picked from the suggestions (its id is kept on the entry); an entry
 * typed by hand is linked only when exactly ONE live client has that very name (and, if a mobile or email was
 * typed, matches it) - a guess that could credit the wrong person is never made.
 */

import { sql } from "drizzle-orm";
import type { Referral } from "@/lib/investors/referral";

const last10 = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "").slice(-10);

async function matchClientByName(tx: any, tenantId: string, r: Referral): Promise<string | null> {
  const name = (r.name ?? "").trim();
  if (name.length < 3) return null;
  const found = (
    await tx.execute(sql`
      SELECT id, phone, email FROM investors
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND lower(btrim(name)) = lower(${name})
       LIMIT 10
    `)
  ).rows as Array<{ id: string; phone: string | null; email: string | null }>;
  const phone = last10(r.mobile);
  const email = (r.email ?? "").trim().toLowerCase();
  const fits = found.filter((c) => {
    if (phone.length === 10 && last10(c.phone) !== phone) return false;
    if (email && (c.email ?? "").trim().toLowerCase() !== email) return false;
    return true;
  });
  return fits.length === 1 ? String(fits[0].id) : null;
}

/**
 * Link / unlink the referred records after client `referrerId`'s referrals change from `before` to `after`.
 * Returns `after` with the ids it resolved filled in, for storing.
 */
export async function syncReferralLinks(
  tx: any,
  tenantId: string,
  referrerId: string,
  before: Referral[],
  after: Referral[]
): Promise<Referral[]> {
  const resolved: Referral[] = [];
  for (const r of after) {
    if (r.investorId || r.leadId) {
      resolved.push(r);
      continue;
    }
    const id = await matchClientByName(tx, tenantId, r);
    resolved.push(id && id !== referrerId ? { ...r, investorId: id } : r);
  }

  const nowClients = new Set(resolved.map((r) => r.investorId).filter((x): x is string => !!x && x !== referrerId));
  const nowLeads = new Set(resolved.map((r) => r.leadId).filter((x): x is string => !!x));
  const goneClients = [...new Set(before.map((r) => r.investorId).filter((x): x is string => !!x && !nowClients.has(x)))];
  const goneLeads = [...new Set(before.map((r) => r.leadId).filter((x): x is string => !!x && !nowLeads.has(x)))];
  const ref = JSON.stringify([referrerId]);

  for (const id of nowClients) {
    await tx.execute(sql`
      UPDATE investors
         SET referred_by_investor_ids = CASE
               WHEN jsonb_exists(COALESCE(referred_by_investor_ids, '[]'::jsonb), ${referrerId}) THEN referred_by_investor_ids
               ELSE COALESCE(referred_by_investor_ids, '[]'::jsonb) || ${ref}::jsonb
             END,
             referred_by_investor_id = COALESCE(referred_by_investor_id, ${referrerId}::uuid),
             updated_at = now()
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
    `);
  }
  for (const id of goneClients) {
    await tx.execute(sql`
      UPDATE investors
         SET referred_by_investor_ids = COALESCE(referred_by_investor_ids, '[]'::jsonb) - ${referrerId}::text,
             referred_by_investor_id = NULLIF((COALESCE(referred_by_investor_ids, '[]'::jsonb) - ${referrerId}::text) ->> 0, '')::uuid,
             updated_at = now()
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `);
  }
  for (const id of nowLeads) {
    await tx.execute(sql`
      UPDATE leads SET referred_by_investor_id = ${referrerId}::uuid, updated_at = now()
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND referred_by_investor_id IS NULL
    `);
  }
  for (const id of goneLeads) {
    await tx.execute(sql`
      UPDATE leads SET referred_by_investor_id = NULL, updated_at = now()
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND referred_by_investor_id = ${referrerId}::uuid
    `);
  }
  return resolved;
}
