import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { AnalyticsDashboard, type MfdRow } from "@/components/super-admin/AnalyticsDashboard";

export const dynamic = "force-dynamic";

export default async function SuperAdminAnalytics() {
  const session = await requireSession();

  const data = await withPlatformAdmin(session.userId, async (tx) => {
    // One cross-tenant row per MFD: signup date, status, and its client counts.
    // The client component derives every chart from this.
    const rows = await tx.execute(sql`
      SELECT
        t.id,
        t.display_name,
        t.created_at,
        t.deleted_at,
        COALESCE(t.status, 'active') AS sub_status,
        (SELECT COUNT(*)::int FROM investors i WHERE i.tenant_id = t.id) AS investors,
        (SELECT COUNT(*)::int FROM investors i WHERE i.tenant_id = t.id AND i.status = 'active') AS active_investors
      FROM tenants t
      ORDER BY t.created_at ASC
    `);


    return {
      mfds: (rows.rows as any[]).map((r): MfdRow => ({
        id: r.id,
        name: r.display_name,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
        status: r.sub_status,
        investors: Number(r.investors ?? 0),
        activeInvestors: Number(r.active_investors ?? 0),
      })),
    };
  });

  return <AnalyticsDashboard mfds={data.mfds} />;
}
