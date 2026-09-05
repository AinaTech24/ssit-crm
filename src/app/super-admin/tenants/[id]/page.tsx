import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq, desc } from "drizzle-orm";
import { ChevronLeft, Building2, Users, TrendingUp } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { tenants, subscriptions, subscriptionEvents, users, investors, packages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative, formatINR } from "@/lib/utils";
import { TenantActions } from "@/components/super-admin/TenantActions";
import { TenantAdminPanel } from "@/components/super-admin/TenantAdminPanel";
import { TenantAccessControl } from "@/components/super-admin/TenantAccessControl";
import { TenantDataScope } from "@/components/super-admin/TenantDataScope";
import { tenantAccessibleNavKeys } from "@/config/nav-access";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
  suspended: "bg-rose-50 text-rose-700",
  expired: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const data = await withPlatformAdmin(session.userId, async (tx) => {
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1))[0];
    if (!tenant) return null;
    const sub = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).limit(1))[0];
    // Owner user — for the editable admin panel.
    const owner = (await tx.execute(sql`
      SELECT id, name, email FROM users WHERE tenant_id = ${id}::uuid AND 'owner' = ANY(roles) AND status <> 'inactive'
      ORDER BY created_at ASC LIMIT 1
    `)).rows[0] as { id: string; name: string; email: string } | undefined;
    const events = await tx
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.tenantId, id))
      .orderBy(desc(subscriptionEvents.at))
      .limit(20);
    const usage = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE tenant_id = ${id} AND status = 'active') AS active_users,
        (SELECT COUNT(DISTINCT user_id)::int FROM user_sessions
           WHERE tenant_id = ${id} AND revoked_at IS NULL AND last_seen_at > now() - interval '5 minutes') AS online_now,
        (SELECT COUNT(*)::int FROM investors WHERE tenant_id = ${id}) AS total_investors,
        (SELECT COUNT(*)::int FROM leads WHERE tenant_id = ${id}) AS total_leads,
        (SELECT COUNT(*)::int FROM transactions WHERE tenant_id = ${id}
           AND created_at >= now() - interval '30 days') AS tx_30d,
        (SELECT COUNT(*)::int FROM workflow_runs WHERE tenant_id = ${id}
           AND created_at >= now() - interval '30 days') AS runs_30d,
        (SELECT COALESCE(SUM(aum::numeric),0) FROM investors WHERE tenant_id = ${id}) AS aum
    `);
    return { tenant, subscription: sub, owner, events, usage: usage.rows[0] as any };
  });

  if (!data) notFound();

  return (
    <div className="space-y-6 max-w-7xl">
      <Link
        href="/super-admin/tenants"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to tenants
      </Link>

      {/* Header */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-lg bg-primary/10 grid place-items-center">
              <Building2 className="size-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{data.tenant.legalName}</h1>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{data.tenant.arn ?? "No ARN"}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[data.tenant.status] ?? ""}`}>
                  {data.tenant.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Created {formatDate(data.tenant.createdAt)} · {data.tenant.email ?? "no contact email"}
              </div>
            </div>
          </div>
          <TenantActions tenantId={id} currentStatus={data.tenant.status ?? "active"} />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Kpi icon={Users} label="Active users" value={data.usage.active_users} />
        <Kpi icon={Users} label="Online now" value={data.usage.online_now} />
        <Kpi icon={Users} label="Investors" value={data.usage.total_investors} />
        <Kpi label="Leads" value={data.usage.total_leads} />
        <Kpi label="Transactions (30d)" value={data.usage.tx_30d} />
        <Kpi label="Workflow runs (30d)" value={data.usage.runs_30d} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold">Account</h2>
          <dl className="mt-3 text-sm">
            <Row label="Status" value={data.tenant.status ?? "active"} />
            <Row label="Created" value={formatDate(data.tenant.createdAt)} />
            <Row label="Suspended reason" value={data.subscription?.suspendedReason ?? "—"} />
            <Row label="AUM" value={formatINR(Number(data.usage.aum))} />
          </dl>
        </div>

        <TenantDataScope
          tenantId={id}
          initialRestricted={!!(data.tenant as any).restrictUserDataScope}
        />

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold">Activity timeline</h2>
          {data.events.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">No events yet.</p>
          ) : (
            <ul className="mt-4 space-y-1 max-h-[28rem] overflow-y-auto scrollbar-none pr-1">
              {data.events.map((e, i) => {
                const tone = eventTone(e.eventType);
                const last = i === data.events.length - 1;
                return (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`size-2.5 rounded-full mt-1.5 ${tone.dot}`} />
                      {!last && <span className="w-px flex-1 bg-border my-1" />}
                    </div>
                    <div className="flex-1 min-w-0 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{eventLabel(e.eventType)}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelative(e.at)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1 flex-wrap">
                        <span>{actorLabel(e.actor)}</span>
                        {(e.fromStatus || e.toStatus) && (
                          <span className="inline-flex items-center gap-1">
                            {e.fromStatus && <span className="px-1.5 py-0.5 rounded bg-muted capitalize">{e.fromStatus}</span>}
                            {e.fromStatus && e.toStatus && <span aria-hidden>→</span>}
                            {e.toStatus && <span className={`px-1.5 py-0.5 rounded capitalize ${tone.chip}`}>{e.toStatus}</span>}
                          </span>
                        )}
                      </div>
                      {e.notes && <div className="text-xs mt-1 text-foreground/80">{e.notes}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <TenantAdminPanel
        tenantId={id}
        currentEmail={data.tenant.email ?? null}
        arn={data.tenant.arn ?? null}
        legalName={data.tenant.legalName}
        displayName={data.tenant.displayName ?? data.tenant.legalName}
        ownerName={data.owner?.name ?? ""}
        ownerEmail={data.owner?.email ?? ""}
      />

      {data.subscription && (
        <TenantAccessControl
          tenantId={id}
          initialAllowedNav={(data.subscription as any).allowedNav as string[] | null}
          initialAllowedFields={data.subscription.allowedFields as string[] | null}
          initialAllowedDashboardWidgets={(data.subscription as any).allowedDashboardWidgets as string[] | null}
          initialFeatureFlags={(data.subscription as any).featureFlagsOverride as Record<string, any> | null}
          packageNavKeys={tenantAccessibleNavKeys({
            allowedNav: null,
            enabledModules: [],
            enabledFeatures: null,
          })}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 py-1.5 border-b last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** Human-friendly label for a subscription_events.eventType. */
function eventLabel(t: string): string {
  const map: Record<string, string> = {
    license_extended: "License extended",
    reactivated: "Reactivated",
    suspended: "Suspended",
    cancelled: "Cancelled",
    created: "Created",
    upgraded: "Plan changed",
    downgraded: "Plan changed",
    payment_succeeded: "Payment received",
    payment_failed: "Payment failed",
    renewed: "Renewed",
  };
  return map[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Turn a raw actor token ("ssit_admin:<uuid>", "system:self_serve_signup") into a name. */
function actorLabel(a: string | null): string {
  if (!a) return "System";
  if (a.startsWith("ssit_admin")) return "Equitywala Admin";
  if (a.includes("self_serve_signup")) return "Self-serve signup";
  if (a.startsWith("razorpay")) return "Razorpay";
  if (a.startsWith("system")) return "System";
  return a;
}

/** Colour for the timeline dot + the to-status chip. */
function eventTone(t: string): { dot: string; chip: string } {
  if (["reactivated", "payment_succeeded", "license_extended", "created", "renewed"].includes(t))
    return { dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (["suspended", "cancelled", "payment_failed"].includes(t))
    return { dot: "bg-rose-500", chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" };
  return { dot: "bg-sky-500", chip: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" };
}

function Kpi({ label, value, icon: Icon }: { label: string; value: number; icon?: any }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3" />}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
