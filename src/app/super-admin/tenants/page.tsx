import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, Building2, Archive, PauseCircle, Clock } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { RetentionSettingForm } from "@/components/super-admin/RetentionSettingForm";
import { TenantsTable, type TenantRow } from "@/components/super-admin/TenantsTable";
import { readSoftDeleteRetentionDays } from "@/lib/platform/retention";
import { pickLogo } from "@/lib/branding/logo";

export const dynamic = "force-dynamic";

type Tab = "current" | "recent" | "deactivated" | "deleted";

export default async function TenantsListPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "deleted" ? "deleted" : sp.tab === "deactivated" ? "deactivated" : sp.tab === "recent" ? "recent" : "current";

  // "inactive" = subscription suspended/cancelled/expired/past_due, OR a lapsed
  // trial/active licence. COALESCE(..., false) so a tenant with NO subscription
  // counts as NOT inactive (otherwise the NULL dropped it from every tab — the
  // "7 shown vs 9 total" bug).
  const inactive = sql`COALESCE((
    s.status IN ('suspended','cancelled','expired','past_due')
    OR (s.status = 'trial' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at < now())
    OR (s.status = 'active' AND s.license_end_at IS NOT NULL AND s.license_end_at < now())
  ), false)`;

  const whereForTab =
    tab === "deleted"
      ? sql`t.deleted_at IS NOT NULL`
      : tab === "recent"
        ? sql`t.deleted_at IS NULL AND t.created_at >= now() - interval '1 month'`
        : tab === "deactivated"
          ? sql`t.deleted_at IS NULL AND ${inactive}`
          : sql`t.deleted_at IS NULL AND NOT ${inactive}`;

  const { rows, counts, retentionDays } = await withPlatformAdmin(session.userId, async (tx) => {
    const counts = (await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE t.deleted_at IS NULL AND NOT ${inactive})::int AS current,
        COUNT(*) FILTER (WHERE t.deleted_at IS NULL AND t.created_at >= now() - interval '1 month')::int AS recent,
        COUNT(*) FILTER (WHERE t.deleted_at IS NULL AND ${inactive})::int AS deactivated,
        COUNT(*) FILTER (WHERE t.deleted_at IS NOT NULL)::int AS deleted
      FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id
    `)).rows[0] as any;

    const list = await tx.execute(sql`
      SELECT t.id, t.legal_name, t.arn, t.created_at, t.email, t.deleted_at,
             t.logo_url, t.logo_icon_url, t.logo_mark_url, t.favicon_url,
             s.status AS sub_status, s.package_key, s.trial_ends_at, s.license_end_at, s.next_renewal_at,
             (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count,
             (SELECT COUNT(*)::int FROM investors i WHERE i.tenant_id = t.id) AS investor_count
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      WHERE ${whereForTab}
      ORDER BY ${tab === "deleted" ? sql`t.deleted_at DESC` : sql`t.created_at DESC`}
    `);

    const retentionDays = await readSoftDeleteRetentionDays(tx as any);
    const rows: TenantRow[] = (list.rows as any[]).map((r) => ({
      ...r,
      logo_url: pickLogo(
        { logoUrl: r.logo_url, logoIconUrl: r.logo_icon_url, logoMarkUrl: r.logo_mark_url, faviconUrl: r.favicon_url },
        "icon"
      ),
    }));
    return { rows, counts, retentionDays };
  });

  const currentCount = Number(counts.current);
  const recentCount = Number(counts.recent);
  const deactivatedCount = Number(counts.deactivated);
  const deletedCount = Number(counts.deleted);

  return (
    <div className="space-y-6 max-w-7xl">
      <AutoRefresh intervalMs={15000} />
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MFD tenants</h1>
          <p className="text-muted-foreground text-sm">
            {currentCount} active · {deactivatedCount} deactivated · {deletedCount} soft-deleted MFD organisations on the platform.
          </p>
        </div>
        <Link
          href="/super-admin/tenants/new"
          className="rounded-lg bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium flex items-center gap-1.5 shadow-sm hover:opacity-95 transition"
        >
          <Plus className="size-4" /> Create MFD tenant
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b overflow-x-auto scrollbar-none">
        <TabLink href="/super-admin/tenants?tab=current" active={tab === "current"} icon={Building2} label="Current" count={currentCount} />
        <TabLink href="/super-admin/tenants?tab=recent" active={tab === "recent"} icon={Clock} label="Recently added" count={recentCount} />
        <TabLink href="/super-admin/tenants?tab=deactivated" active={tab === "deactivated"} icon={PauseCircle} label="Deactivated" count={deactivatedCount} />
        <TabLink href="/super-admin/tenants?tab=deleted" active={tab === "deleted"} icon={Archive} label="Soft-deleted" count={deletedCount} />
      </div>

      {tab === "recent" && (
        <p className="text-xs text-muted-foreground -mt-2">MFD organisations created in the last 30 days.</p>
      )}

      {tab === "deleted" && (
        <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg border border-border bg-secondary/30 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Soft-deleted tenants keep all their data and can be recovered. After the retention window they become eligible for permanent purge.
          </span>
          <RetentionSettingForm current={retentionDays} />
        </div>
      )}

      <TenantsTable rows={rows} tab={tab} retentionDays={retentionDays} />
    </div>
  );
}

function TabLink({ href, active, icon: Icon, label, count }: { href: string; active: boolean; icon: any; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-4" /> {label}
      <span className={`text-[11px] px-1.5 rounded-full ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{count}</span>
    </Link>
  );
}
