import Link from "next/link";
import { sql } from "drizzle-orm";
import { Building2, Activity, AlertTriangle, TrendingUp } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";
import { AutoRefresh } from "@/components/common/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function SuperAdminOverview() {
  const session = await requireSession();
  const data = await withPlatformAdmin(session.userId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM tenants) AS total_tenants,
        (SELECT COUNT(*)::int FROM tenants WHERE status = 'active') AS active_tenants,
        (SELECT COUNT(*)::int FROM users WHERE status = 'active') AS active_users,
        (SELECT COUNT(*)::int FROM support_tickets WHERE status IN ('open', 'in_progress')) AS open_tickets
    `);
    const s = stats.rows[0] as any;

    const newTenants = await tx.execute(sql`
      SELECT t.id, t.legal_name, t.arn, t.status, t.created_at
      FROM tenants t
      ORDER BY t.created_at DESC
      LIMIT 10
    `);

    return {
      totalTenants: Number(s.total_tenants),
      activeTenants: Number(s.active_tenants),
      activeUsers: Number(s.active_users),
      openTickets: Number(s.open_tickets),
      newTenants: newTenants.rows as any[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Live-update the overview as tenants/activity change (no manual refresh). */}
      <AutoRefresh intervalMs={15000} />

      {/* Hero summary band */}
      <div className="rounded-2xl border border-border overflow-hidden shadow-sm">
        <div className="px-6 py-5 text-white" style={{ background: "linear-gradient(135deg, hsl(358 75% 41%) 0%, hsl(358 78% 28%) 100%)" }}>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-white/70 font-semibold">Platform health</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{data.totalTenants} <span className="text-base font-medium text-white/75">MFD tenants</span></div>
            </div>
            <div className="flex gap-6">
              <HeroStat label="Active" value={data.activeTenants} />
              <HeroStat label="Users" value={data.activeUsers} />
              <HeroStat label="Open tickets" value={data.openTickets} alert={data.openTickets > 0} />
            </div>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total tenants" value={data.totalTenants} icon={Building2} tone="brand" />
        <Kpi label="Active tenants" value={data.activeTenants} tone="emerald" icon={Activity} />
        <Kpi label="Active users" value={data.activeUsers} tone="blue" icon={TrendingUp} />
        <Kpi label="Open tickets" value={data.openTickets} tone={data.openTickets > 0 ? "amber" : "muted"} icon={AlertTriangle} />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Panel title="New tenants" action={<Link href="/super-admin/tenants" className="text-xs text-primary hover:underline font-medium">View all →</Link>}>
          {data.newTenants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No tenants yet. <Link href="/super-admin/tenants/new" className="text-primary hover:underline">Create one</Link>.
            </p>
          ) : (
            <ul className="divide-y max-h-[24rem] overflow-y-auto scrollbar-none">
              {data.newTenants.map((t: any) => (
                <li key={t.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/super-admin/tenants/${t.id}`} className="font-medium hover:underline truncate block">{t.legal_name}</Link>
                    <div className="text-xs text-muted-foreground truncate">{t.arn ?? "no ARN"} · {t.status}</div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{formatRelative(t.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

      </div>
    </div>
  );
}

function HeroStat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="text-right">
      <div className={`text-2xl font-bold tabular-nums ${alert ? "text-amber-200" : ""}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-white/70">{label}</div>
    </div>
  );
}

function Panel({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border rounded-xl bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-sm">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: "rose" | "amber" | "emerald" | "blue" | "muted" | "brand";
  icon?: any;
}) {
  const tones: Record<string, string> = {
    rose: "text-rose-600 bg-rose-500/10",
    amber: "text-amber-600 bg-amber-500/10",
    emerald: "text-emerald-600 bg-emerald-500/10",
    blue: "text-blue-600 bg-blue-500/10",
    brand: "text-primary bg-primary/10",
    muted: "text-muted-foreground bg-muted",
  };
  return (
    <div className="border rounded-xl p-4 bg-card shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        {Icon && <span className={`size-7 rounded-lg grid place-items-center ${tones[tone ?? "muted"]}`}><Icon className="size-4" /></span>}
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums">{value.toLocaleString("en-IN")}</div>
    </div>
  );
}
