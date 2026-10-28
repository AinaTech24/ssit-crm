/**
 * Tell the people responsible for a client when something changes on it.
 *
 * A note, a meeting or a service request added to a client's record by somebody
 * else is something the client's relationship manager, its service RM and the
 * branch head above them should hear about — otherwise it is only discovered by
 * opening the record. The notification surfaces as a pop-up at the bottom right
 * (see PopupAlerts) and in the bell.
 *
 * Recipients: the client's RM, its Service RM, and every active branch head whose
 * branch (or desk, for a head confined to one) the RM sits in. The person who made
 * the change is never told about their own edit.
 */

import { sql } from "drizzle-orm";
import { createNotification } from "./create";

export async function notifyClientTeam(
  tx: any,
  n: {
    tenantId: string;
    investorId: string;
    actorUserId: string;
    kind: string;
    title: string;
    body?: string | null;
    linkUrl?: string | null;
  }
): Promise<void> {
  try {
    const r = await tx.execute(sql`
      SELECT i.name, i.rm_id, i.service_rm_id,
             rm.branch_id AS rm_branch, rm.desk_id AS rm_desk
        FROM investors i
        LEFT JOIN users rm ON rm.id = i.rm_id
       WHERE i.id = ${n.investorId}::uuid AND i.tenant_id = ${n.tenantId}::uuid
       LIMIT 1
    `);
    const inv = r.rows[0] as
      | { name: string | null; rm_id: string | null; service_rm_id: string | null; rm_branch: string | null; rm_desk: string | null }
      | undefined;
    if (!inv) return;

    const to = new Set<string>();
    if (inv.rm_id) to.add(inv.rm_id);
    if (inv.service_rm_id) to.add(inv.service_rm_id);

    if (inv.rm_branch || inv.rm_desk) {
      const heads = await tx.execute(sql`
        SELECT id FROM users
         WHERE tenant_id = ${n.tenantId}::uuid
           AND status = 'active'
           AND 'branch_head' = ANY(roles)
           AND (
             (desk_id IS NOT NULL AND desk_id IS NOT DISTINCT FROM ${inv.rm_desk}::uuid)
             OR (desk_id IS NULL AND branch_id IS NOT DISTINCT FROM ${inv.rm_branch}::uuid)
           )
      `);
      for (const h of heads.rows as { id: string }[]) to.add(h.id);
    }
    to.delete(n.actorUserId);

    for (const userId of to) {
      await createNotification(tx, {
        tenantId: n.tenantId,
        userId,
        kind: n.kind,
        title: n.title.replace("{client}", inv.name ?? "a client"),
        body: n.body ?? null,
        linkUrl: n.linkUrl ?? `/dashboard/investors/${n.investorId}`,
        severity: "info",
        meta: { investorId: n.investorId, by: n.actorUserId },
      });
    }
  } catch (err) {
    // A missed heads-up must never fail the note / meeting / request itself.
    console.error("[notifyClientTeam] failed", err instanceof Error ? err.message : err);
  }
}
