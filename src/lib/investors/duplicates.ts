/**
 * Possible-duplicate detection for the Clients list banner. Counts live (non-
 * merged, non-closed) clients that share a PAN or a normalised mobile with
 * another client — the candidates the merge tool should look at. Cheap enough
 * to run on the list page; the actual merge happens in /dashboard/duplicates.
 *
 * Timely because the Excel importer now allows duplicate PANs on purpose
 * (dedup_pan=false), so duplicates accumulate and need a visible nudge.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export async function countPossibleDuplicates(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.execute(sql`
    WITH live AS (
      SELECT id,
             NULLIF(upper(trim(pan)), '') AS pan,
             NULLIF(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '') AS phone
      FROM investors
      WHERE tenant_id = ${tenantId}::uuid AND merged_into_id IS NULL AND status <> 'closed' AND deleted_at IS NULL
    ),
    dup_pan AS (SELECT pan FROM live WHERE pan IS NOT NULL GROUP BY pan HAVING count(*) > 1),
    dup_phone AS (SELECT phone FROM live WHERE phone IS NOT NULL AND length(phone) >= 10 GROUP BY phone HAVING count(*) > 1)
    SELECT count(DISTINCT l.id)::int AS n
    FROM live l
    WHERE l.pan IN (SELECT pan FROM dup_pan) OR l.phone IN (SELECT phone FROM dup_phone)
  `);
  return Number((r.rows[0] as any)?.n ?? 0);
}
