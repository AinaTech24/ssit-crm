/**
 * Every "client A referred B" relationship, as one derived table (alias it `l`).
 *
 * Two sources feed it:
 *   - leads that carry a referring client (leads.referred_by_investor_id), the
 *     original path: a referral arrives as a lead and may later convert;
 *   - clients that carry referring clients (investors.referred_by_investor_ids,
 *     migrations 0261 / 0264, one row per referrer): someone added directly or imported, who is already a client.
 *
 * A lead that converted into a client who also carries the same referrer is the SAME
 * referral, so the client row is left out when a lead already covers it - nothing is
 * counted twice. A referred client is by definition converted.
 *
 * Columns match what the Referral Tracking queries read from `leads`.
 */

import { sql } from "drizzle-orm";

export const referralLinksSql = sql`(
  SELECT l0.id, l0.tenant_id, l0.referred_by_investor_id, l0.converted_investor_id,
         l0.stage::text AS stage, l0.interest_products AS interest_products
    FROM leads l0
   WHERE l0.referred_by_investor_id IS NOT NULL
  UNION ALL
  SELECT n.id, n.tenant_id, r.rid::uuid AS referred_by_investor_id, n.id AS converted_investor_id,
         'converted'::text AS stage, '[]'::jsonb AS interest_products
    FROM investors n
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(n.referred_by_investor_ids, '[]'::jsonb)) AS r(rid)
   WHERE n.deleted_at IS NULL
     AND r.rid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND NOT EXISTS (
       SELECT 1 FROM leads l2
        WHERE l2.converted_investor_id = n.id
          AND l2.referred_by_investor_id = r.rid::uuid
     )
)`;
