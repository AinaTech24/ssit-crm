import Link from "next/link";
import { sql } from "drizzle-orm";
import { Briefcase, FileSignature, Gauge, HeartHandshake, ListChecks, CalendarClock } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { dataScopeSqlFor } from "@/lib/auth/data-scope";
import { formatINR, formatDate, formatRelative } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { DashboardEmptyState } from "@/components/dashboards/DashboardEmptyState";
import { loadTenantLicense } from "@/lib/auth/license";
import { tenantAccessibleNavKeys } from "@/config/nav-access";

/**
 * RIA dashboard — a Registered Investment Advisor works fee-based advice, not
 * a commission book. The RM cockpit (SIP book, net sales, lead conversion)
 * measures the wrong thing for this role entirely, which is why RIA rode it
 * for so long with half the tiles reading "—". This one measures what an RIA
 * is actually reviewed on: assets under advice, financial plans in flight,
 * whether every client has a risk profile on file, and reviews due.
 *
 * Scoped by the same data wall as everything else (lib/auth/data-scope.ts) —
 * an RIA sees their own clients unless branch-granted, exactly like an RM.
 */
type KpiRow = { clients: number | string | null; aua: number | string | null };
type PlanCountRow = { draft: number | string | null; finalized: number | string | null };
type PlanRow = { id: string; plan_number: string; status: string; client_name: string | null };
type RiskGapRow = { id: string; name: string; avatar_url: string | null; last_profiled: string | null };
type CountRow = { n: number | string | null };
type ReviewDueRow = { id: string; name: string; avatar_url: string | null; next_review_at: string; segment_tag: string | null };
type TaskRow = { id: string; title: string; priority: string; due_at: string | null };

export async function RiaDashboard({ session }: { session: SessionUser }) {
  // Only show a section/link for a module this firm actually has turned on —
  // an RIA dashboard hard-coded every section regardless of which CRM modules
  // the tenant is licensed for, so a firm without (say) Financial Plans still
  // saw an empty "Financial plans" card pointing at a page they can't open.
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const navKeys = new Set(
    tenantAccessibleNavKeys({
      allowedNav: license.allowedNav,
      navGrantCatalog: license.navGrantCatalog,
      enabledModules: license.enabledModules,
      enabledFeatures: license.enabledFeatures,
    })
  );
  const showNav = (href: string) => navKeys.has(href);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Every query below aliases the table as "i" — the scope predicate must
    // use the SAME alias, or Postgres can't resolve it ("invalid reference to
    // FROM-clause entry for table investors").
    const clientScope = await dataScopeSqlFor(tx, session, {
      branch: "i.branch_id",
      owner: ["i.rm_id", "i.service_rm_id"],
    });

    const kpi = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS clients,
        COALESCE(SUM(aum::numeric), 0)::numeric AS aua
      FROM investors i
      WHERE i.status = 'active' AND i.deleted_at IS NULL AND ${clientScope}
    `);
    const k = kpi.rows[0] as unknown as KpiRow;

    // Financial plans this RIA prepared — the core advisory output.
    const plans = await tx.execute(sql`
      SELECT fp.id, fp.plan_number, fp.status, fp.created_at,
             COALESCE(i.name, l.name) AS client_name, i.id AS investor_id, l.id AS lead_id
      FROM financial_plans fp
      LEFT JOIN investors i ON i.id = fp.investor_id
      LEFT JOIN leads l ON l.id = fp.lead_id
      WHERE fp.tenant_id = ${session.tenantId}::uuid AND fp.prepared_by_user_id = ${session.userId}::uuid
      ORDER BY fp.created_at DESC
      LIMIT 8
    `);
    const planCounts = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE status = 'finalized')::int AS finalized
      FROM financial_plans
      WHERE tenant_id = ${session.tenantId}::uuid AND prepared_by_user_id = ${session.userId}::uuid
    `);
    const pc = planCounts.rows[0] as unknown as PlanCountRow;

    // Risk profile coverage — a client with no response on file at all, or
    // none in the last 12 months (SEBI RIA regulations expect an annual
    // refresh). Only counts clients IN SCOPE, so this is "my gaps", not the
    // firm's.
    const riskGaps = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url,
             (SELECT MAX(profile_date) FROM risk_profile_responses r WHERE r.investor_id = i.id) AS last_profiled
      FROM investors i
      WHERE i.status = 'active' AND i.deleted_at IS NULL AND ${clientScope}
        AND NOT EXISTS (
          SELECT 1 FROM risk_profile_responses r
          WHERE r.investor_id = i.id AND r.profile_date >= current_date - interval '365 days'
        )
      ORDER BY i.name ASC
      LIMIT 8
    `);
    const riskGapTotal = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM investors i
      WHERE i.status = 'active' AND i.deleted_at IS NULL AND ${clientScope}
        AND NOT EXISTS (
          SELECT 1 FROM risk_profile_responses r
          WHERE r.investor_id = i.id AND r.profile_date >= current_date - interval '365 days'
        )
    `);

    // Reviews due — same cadence field every book uses.
    const reviewsDue = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.next_review_at, i.segment_tag
      FROM investors i
      WHERE i.status = 'active' AND i.deleted_at IS NULL AND ${clientScope}
        AND i.next_review_at IS NOT NULL
        AND i.next_review_at <= now() + interval '7 days'
      ORDER BY i.next_review_at ASC
      LIMIT 8
    `);

    // Families under advice — RIA holds family.manage; a household view of the
    // same book, since advice is usually given at the family level.
    const families = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM families
      WHERE tenant_id = ${session.tenantId}::uuid AND rm_id = ${session.userId}::uuid
    `);

    // My open tasks — same shape every dashboard shows.
    const tasks = await tx.execute(sql`
      SELECT id, title, priority, due_at
      FROM tasks
      WHERE tenant_id = ${session.tenantId}::uuid AND assignee_id = ${session.userId}::uuid
        AND status NOT IN ('completed', 'cancelled') AND deleted_at IS NULL
      ORDER BY due_at ASC NULLS LAST
      LIMIT 8
    `);

    return {
      clients: Number(k.clients ?? 0),
      aua: Number(k.aua ?? 0),
      draftPlans: Number(pc.draft ?? 0),
      finalizedPlans: Number(pc.finalized ?? 0),
      plans: plans.rows as unknown as PlanRow[],
      riskGaps: riskGaps.rows as unknown as RiskGapRow[],
      riskGapTotal: Number((riskGapTotal.rows[0] as unknown as CountRow | undefined)?.n ?? 0),
      reviewsDue: reviewsDue.rows as unknown as ReviewDueRow[],
      families: Number((families.rows[0] as unknown as CountRow | undefined)?.n ?? 0),
      tasks: tasks.rows as unknown as TaskRow[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My day</h1>
        <p className="text-muted-foreground text-sm">
          Hi {session.name.split(" ")[0]} — assets under advice, plans in flight, and who still needs a risk profile.
        </p>
      </div>

      <div className="card-surface glass-card p-4">
        <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-3">At a glance</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {showNav("/dashboard/investors") && (
            <Kpi label="My clients" value={String(data.clients)} sub={`${formatINR(data.aua)} AUA`} />
          )}
          {showNav("/dashboard/financial-plans") && (
            <Kpi label="Financial plans" value={String(data.draftPlans + data.finalizedPlans)} sub={`${data.draftPlans} draft · ${data.finalizedPlans} final`} />
          )}
          {showNav("/dashboard/risk-profiles") && (
            <Kpi label="Risk profile gaps" value={String(data.riskGapTotal)} sub="No response in 12 months" tone={data.riskGapTotal > 0 ? "amber" : undefined} />
          )}
          {showNav("/dashboard/investors") && (
            <Kpi label="Reviews due" value={String(data.reviewsDue.length)} sub="Next 7 days" />
          )}
          {showNav("/dashboard/families") && (
            <Kpi label="Families" value={String(data.families)} sub="Under advice" />
          )}
        </div>
      </div>

      {(showNav("/dashboard/financial-plans") || showNav("/dashboard/risk-profiles")) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {showNav("/dashboard/financial-plans") && (
            <Section title="Financial plans" count={data.plans.length} icon={FileSignature}>
              {data.plans.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No financial plans yet"
                  hint="Start one from a client's page to capture goals, cash flow and an asset-allocation recommendation."
                  cta={{ href: "/dashboard/financial-plans", label: "Financial plans" }}
                />
              ) : (
                <ul className="divide-y">
                  {data.plans.map((p: PlanRow) => (
                    <li key={p.id} className="py-2 flex items-center justify-between text-sm gap-2">
                      <Link href={`/dashboard/financial-plans/${p.id}`} className="min-w-0 hover:underline">
                        <span className="block truncate font-medium">{p.client_name ?? p.plan_number}</span>
                        <span className="block text-[11px] text-muted-foreground">{p.plan_number}</span>
                      </Link>
                      <span className={`chip text-xs border ${p.status === "finalized" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {p.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {showNav("/dashboard/risk-profiles") && (
            <Section title="Risk profile gaps" count={data.riskGaps.length} icon={Gauge}>
              {data.riskGaps.length === 0 ? (
                <DashboardEmptyState compact title="Every client is covered 🎉" hint="No client is missing a risk profile from the last 12 months." />
              ) : (
                <ul className="divide-y">
                  {data.riskGaps.map((c: RiskGapRow) => (
                    <li key={c.id} className="py-2 flex items-center justify-between text-sm gap-2">
                      <Link href={`/dashboard/investors/${c.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                        <Avatar src={c.avatar_url ? `/api/investors/${c.id}/avatar` : null} name={c.name} size={26} />
                        <span className="truncate">{c.name}</span>
                      </Link>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {c.last_profiled ? `Last ${formatDate(c.last_profiled)}` : "Never profiled"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {showNav("/dashboard/investors") && (
          <Section title="Reviews due" count={data.reviewsDue.length} icon={CalendarClock}>
            {data.reviewsDue.length === 0 ? (
              <DashboardEmptyState compact title="Nothing due this week 🎉" hint="No client review falls in the next 7 days." />
            ) : (
              <ul className="divide-y">
                {data.reviewsDue.map((c: ReviewDueRow) => (
                  <li key={c.id} className="py-2 flex items-center justify-between text-sm gap-2">
                    <Link href={`/dashboard/investors/${c.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                      <Avatar src={c.avatar_url ? `/api/investors/${c.id}/avatar` : null} name={c.name} size={26} />
                      <span className="truncate">{c.name}</span>
                    </Link>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(c.next_review_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {showNav("/dashboard/tasks") && (
          <Section title="My open tasks" count={data.tasks.length} icon={ListChecks}>
            {data.tasks.length === 0 ? (
              <DashboardEmptyState compact title="No open tasks 🎉" hint="Your task list is clear." />
            ) : (
              <ul className="divide-y">
                {data.tasks.map((t: TaskRow) => (
                  <li key={t.id} className="py-2 flex items-center justify-between text-sm">
                    <span className="truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{t.due_at ? formatRelative(t.due_at) : "no due"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {showNav("/dashboard/investors") && (
          <Link href="/dashboard/investors" className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <Briefcase className="size-3.5" /> My clients
          </Link>
        )}
        {showNav("/dashboard/families") && (
          <Link href="/dashboard/families" className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <HeartHandshake className="size-3.5" /> Family mapping
          </Link>
        )}
        {showNav("/dashboard/risk-profiles") && (
          <Link href="/dashboard/risk-profiles" className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <Gauge className="size-3.5" /> Risk profiles
          </Link>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "amber" }) {
  return (
    <div className="rounded-xl border bg-background/60 p-4">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-2 tracking-tight ${tone === "amber" ? "text-amber-600" : "text-gradient"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1 font-medium">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="card-surface glass-card p-5">
      <div className="font-semibold flex items-center justify-between mb-3">
        <span className="text-sm font-semibold tracking-tight text-foreground/90 flex items-center gap-1.5">
          {Icon && <Icon className="size-4 text-brand-cyan" />} {title}
        </span>
        {count !== undefined && (
          <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-xs font-semibold px-2 py-0.5">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}
