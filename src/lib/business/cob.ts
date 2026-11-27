/**
 * COB (change of broker) follow-up.
 *
 * A business entry with a COB line is due for a check COB_DAYS after its business date. When that day arrives the
 * client's RM and the person who executed the transaction are notified (once, plus a daily pop-up until answered)
 * and answer on the entry: Yes, done - or No, with the reason.
 */

import { sql } from "drizzle-orm";
import { createNotification } from "@/lib/notifications/create";

export const COB_DAYS = 12;

/** Today in India as yyyy-mm-dd. */
export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Set or clear the follow-up to match the entry as it now stands - call after creating or changing it. An answer
 * already given is kept; moving the business date moves the due day and notifies again.
 */
export async function syncCobFollowUp(tx: any, tenantId: string, entryId: string): Promise<void> {
  const wants = sql`(e.status <> 'cancelled' AND EXISTS (SELECT 1 FROM business_entry_lines l WHERE l.entry_id = e.id AND l.txn_type = 'cob'))`;
  const due = sql`(CASE WHEN ${wants} THEN e.business_date + ${COB_DAYS}::int ELSE NULL END)`;
  await tx.execute(sql`
    UPDATE business_entries e
       SET cob_due_on = ${due},
           cob_status = CASE WHEN ${wants} THEN COALESCE(e.cob_status, 'pending') ELSE NULL END,
           cob_notified_at = CASE WHEN e.cob_due_on IS DISTINCT FROM ${due} THEN NULL ELSE e.cob_notified_at END
     WHERE e.id = ${entryId}::uuid AND e.tenant_id = ${tenantId}::uuid
  `);
}

/** Send the one-time bell notification for every follow-up that has just come due. Safe to call often. */
export async function notifyDueCob(tx: any, tenantId: string): Promise<void> {
  // Claiming the rows in the same statement means two people polling at once cannot both send it.
  const claimed = await tx.execute(sql`
    UPDATE business_entries e
       SET cob_notified_at = now()
     WHERE e.tenant_id = ${tenantId}::uuid AND e.cob_status = 'pending' AND e.status <> 'cancelled'
       AND e.cob_notified_at IS NULL AND e.cob_due_on <= ${istToday()}::date
    RETURNING e.id, e.client_name, e.rm_id, e.executed_by_id,
              (SELECT i.rm_id FROM investors i WHERE i.id = e.investor_id) AS client_rm_id
  `);
  for (const r of claimed.rows as Array<{ id: string; client_name: string; rm_id: string | null; executed_by_id: string | null; client_rm_id: string | null }>) {
    const people = new Set([r.client_rm_id ?? r.rm_id, r.executed_by_id].filter((x): x is string => !!x));
    for (const userId of people) {
      await createNotification(tx, {
        tenantId,
        userId,
        kind: "business.cob_due",
        title: `COB check: ${r.client_name}`,
        body: `${COB_DAYS} days have passed since this client's change of broker. Is it done? Open the entry and answer Yes or No.`,
        linkUrl: `/dashboard/business-entries/${r.id}`,
        severity: "warning",
        meta: { business_entry_id: r.id },
      });
    }
  }
}
