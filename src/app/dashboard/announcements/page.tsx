import { sql } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { AnnouncementBoard } from "@/components/announcements/AnnouncementBoard";
import { branches } from "@/db/schema";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

export default async function AnnouncementsPage() {
  const session = await requireSession();
  const manager = isManager(session.roles);

  const { rows, branchRows } = await withTenant(session.tenantId, async (tx) => {
    let rRows: any[];
    if (manager) {
      const r = await tx.execute(sql`
        SELECT a.*, u.name AS created_by_name,
               (SELECT count(*)::int FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count,
               (SELECT count(*)::int FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.acknowledged_at IS NOT NULL) AS ack_count
        FROM announcements a LEFT JOIN users u ON u.id = a.created_by_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
        ORDER BY a.is_pinned DESC, COALESCE(a.published_at, a.created_at) DESC
        LIMIT 200
      `);
      rRows = r.rows;
    } else {
      const rolesJson = JSON.stringify(session.roles);
      const r = await tx.execute(sql`
        SELECT a.id, a.title, a.body, a.category, a.is_pinned, a.published_at, a.expires_at, a.audience_roles, a.branch_id,
               a.requires_ack,
               (ar.read_at IS NOT NULL) AS is_read,
               (ar.acknowledged_at IS NOT NULL) AS is_acknowledged,
               u.name AS created_by_name
        FROM announcements a
        LEFT JOIN users u ON u.id = a.created_by_user_id
        LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = ${session.userId}::uuid
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.published_at IS NOT NULL AND a.published_at <= now()
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND (a.branch_id IS NULL OR a.branch_id = ${session.branchId ?? null})
          AND (
            a.audience_roles IS NULL
            OR jsonb_array_length(a.audience_roles) = 0
            OR a.audience_roles ?| array(SELECT jsonb_array_elements_text(${rolesJson}::jsonb))
          )
        ORDER BY a.is_pinned DESC, a.published_at DESC
        LIMIT 100
      `);
      rRows = r.rows;
    }

    const bList = await tx
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .orderBy(branches.name);

    return { rows: rRows, branchRows: bList };
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Megaphone className="size-6 text-brand-cyan" /> Announcements</h1>
      </div>
      <AnnouncementBoard rows={rows} branches={branchRows} isManager={manager} />
    </div>
  );
}
