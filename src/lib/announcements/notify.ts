/**
 * Fan out an in-app notification to every staff member an announcement targets
 * (active users matching its audience roles + branch), so a published notice
 * actively reaches people instead of only sitting on the dashboard. One
 * statement (INSERT … SELECT) — cheap even for larger teams.
 */
import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };
type Ann = {
  id: string;
  title: string;
  category: string;
  audienceRoles?: string[] | null;
  branchId?: string | null;
  createdByUserId?: string | null;
};

export async function notifyAnnouncementPublished(tx: Tx, tenantId: string, a: Ann): Promise<number> {
  const roles = (a.audienceRoles ?? []) as string[];
  const roleCond = roles.length
    ? sql` AND u.roles && ARRAY[${sql.join(roles.map((r) => sql`${r}`), sql`, `)}]::text[]`
    : sql``;
  const branchCond = a.branchId ? sql` AND u.branch_id = ${a.branchId}::uuid` : sql``;
  const excludePoster = a.createdByUserId ? sql` AND u.id <> ${a.createdByUserId}::uuid` : sql``;
  const severity = a.category === "urgent" ? "critical" : a.category === "policy" ? "warning" : "info";
  const body = a.category === "urgent" ? "Urgent announcement — please read" : "New announcement";
  const metaJson = JSON.stringify({ announcementId: a.id, category: a.category });

  const res = await tx.execute(sql`
    INSERT INTO notifications (tenant_id, user_id, kind, title, body, link_url, severity, meta)
    SELECT ${tenantId}::uuid, u.id, 'announcement.published', ${a.title}, ${body},
           '/dashboard/announcements', ${severity}, ${metaJson}::jsonb
    FROM users u
    WHERE u.tenant_id = ${tenantId}::uuid AND u.status = 'active'${branchCond}${roleCond}${excludePoster}
    RETURNING 1
  `);
  return res.rows.length;
}
