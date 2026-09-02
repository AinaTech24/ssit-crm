import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { AnalyticsDashboard, type MfdRow } from "@/components/super-admin/AnalyticsDashboard";

export const dynamic = "force-dynamic";

export default async function SuperAdminAnalytics() {
  const session = await requireSession();

  const data = await withPlatformAdmin(session.userId, async (tx) => {
    // One cross-tenant row per MFD: signup date, license status, plan, and its
    // client/investor counts. The client component derives every chart from this.
    const rows = await tx.execute(sql`
      SELECT
        t.id,
        t.display_name,
        t.created_at,
        t.deleted_at,
        COALESCE(s.status, 'pending') AS sub_status,
        s.package_key,
        s.license_end_at,
        s.trial_ends_at,
        (SELECT COUNT(*)::int FROM investors i WHERE i.tenant_id = t.id) AS investors,
        (SELECT COUNT(*)::int FROM investors i WHERE i.tenant_id = t.id AND i.status = 'active') AS active_investors
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      ORDER BY t.created_at ASC
    `);

    const extended = await tx.execute(sql`
      SELECT COUNT(DISTINCT subscription_id)::int AS c
      FROM subscription_events
      WHERE event_type = 'license_extended'
    `);

    return {
      mfds: (rows.rows as any[]).map((r): MfdRow => ({
        id: r.id,
        name: r.display_name,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
        status: r.sub_status,
        packageKey: r.package_key ?? null,
        licenseEndAt: r.license_end_at ? new Date(r.license_end_at).toISOString() : null,
        investors: Number(r.investors ?? 0),
        activeInvestors: Number(r.active_investors ?? 0),
      })),
      extendedCount: Number((extended.rows[0] as any)?.c ?? 0),
    };
  });

  return <AnalyticsDashboard mfds={data.mfds} extendedCount={data.extendedCount} />;
}
