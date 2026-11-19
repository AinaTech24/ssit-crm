/**
 * Every "client A referred B" relationship, as one derived table (alias it `l`).
 *
 * Two sources feed it:
 *   - leads that carry a referring client (leads.referred_by_investor_id), the
 *     original path: a referral arrives as a lead and may later convert;
 *   - clients that carry a referring client (investors.referred_by_investor_id,
 *     migration 0261): someone added directly or imported, who is already a client.
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
  SELECT n.id, n.tenant_id, n.referred_by_investor_id, n.id AS converted_investor_id,
         'converted'::text AS stage, '[]'::jsonb AS interest_products
    FROM investors n
   WHERE n.referred_by_investor_id IS NOT NULL
     AND n.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM leads l2
        WHERE l2.converted_investor_id = n.id
          AND l2.referred_by_investor_id = n.referred_by_investor_id
     )
)`;
