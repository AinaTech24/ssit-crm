import Link from "next/link";
import { sql } from "drizzle-orm";
import { FlaskConical, Phone, ListChecks, CalendarClock, TrendingUp, FileSignature } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { leadScopeSql } from "@/lib/leads/access";
import { formatRelative, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { DashboardEmptyState } from "@/components/dashboards/DashboardEmptyState";
import { formatTrackerItems, type TrackerItem } from "@/db/schema/activity_entries";
import { loadTenantLicense } from "@/lib/auth/license";
import { tenantAccessibleNavKeys } from "@/config/nav-access";

/**
 * RA (Research Analyst) dashboard — the two people this platform files under
 * "RA" do different jobs, and neither one is "runs a client book with an AUM
 * target", which is what dashboard.view.rm assumed for both before this:
 *
 *   ra_research  studies things and produces notes/reports/models — reviewed
 *                on OUTPUT, tracked in the Daily Activity Tracker.
 *   ra_sales     works the lead pipeline into proposals and meetings — reviewed
 *                on CONVERSION, same shape as an RM's funnel but with no book
 *                of existing clients to speak of (no investor.edit.*).
 *
 * One shell, two bodies — picked by which of the two roles the session holds.
 * A user holding both (rare, but roles stack) sees both bodies.
 */
type ResearchCountRow = { week_count: number | string | null; month_count: number | string | null };
type ResearchEntryRow = { id: string; title: string; topic: string | null; items: TrackerItem[] | null; item_type: string | null; status: string; assigned_date: string };
type FunnelRow = { open: number | string | null; converted_mtd: number | string | null; follow_ups_today: number | string | null };
type LeadRow = { id: string; name: string; avatar_url: string | null; stage: string; next_follow_up_at: string };
type CountRow = { n: number | string | null };
type TaskRow = { id: string; title: string; priority: string; due_at: string | null };

export async function RaDashboard({ session }: { session: SessionUser }) {
  const isResearch = session.roles.includes("ra_research");
  const isSales = session.roles.includes("ra_sales");

  // Only render sections for modules this firm actually has turned on — the
  // sales body's Leads/Proposals/Meetings links used to show unconditionally
  // even for a tenant without those modules enabled.
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const navKeys = new Set(
    tenantAccessibleNavKeys({
      allowedNav: license.allowedNav,
      enabledModules: license.enabledModules,
      enabledFeatures: license.enabledFeatures,
    })
  );
  const showNav = (href: string) => navKeys.has(href);

  const data = await withTenant(session.tenantId, async (tx) => {
    const tasks = await tx.execute(sql`
      SELECT id, title, priority, due_at
      FROM tasks
      WHERE tenant_id = ${session.tenantId}::uuid AND assignee_id = ${session.userId}::uuid
        AND status NOT IN ('completed', 'cancelled') AND deleted_at IS NULL
      ORDER BY due_at ASC NULLS LAST
      LIMIT 8
    `);

    let research: { weekCount: number; monthCount: number; recent: ResearchEntryRow[] } | null = null;
    if (isResearch) {
      const counts = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE assigned_date >= date_trunc('week', current_date))::int AS week_count,
          COUNT(*) FILTER (WHERE assigned_date >= date_trunc('month', current_date))::int AS month_count
        FROM activity_entries
        WHERE tenant_id = ${session.tenantId}::uuid AND owner_user_id = ${session.userId}::uuid AND kind = 'research'
      `);
      const c = counts.rows[0] as unknown as ResearchCountRow;
      const recent = await tx.execute(sql`
        SELECT id, title, topic, items, item_type, status, assigned_date
        FROM activity_entries
        WHERE tenant_id = ${session.tenantId}::uuid AND owner_user_id = ${session.userId}::uuid AND kind = 'research'
        ORDER BY assigned_date DESC, created_at DESC
        LIMIT 8
      `);
      research = { weekCount: Number(c.week_count ?? 0), monthCount: Number(c.month_count ?? 0), recent: recent.rows as unknown as ResearchEntryRow[] };
    }

    let salesFunnel: { open: number; convertedMtd: number; followUpsToday: number; leads: LeadRow[]; meetingsDue: number } | null = null;
    if (isSales) {
      const leadScope = await leadScopeSql(tx, session, "leads");
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      const funnel = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold'))::int AS open,
          COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL
            AND converted_at >= date_trunc('month', current_date))::int AS converted_mtd,
          COUNT(*) FILTER (WHERE next_follow_up_at <= ${endOfDay.toISOString()}
            AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold'))::int AS follow_ups_today
        FROM leads WHERE ${leadScope}
      `);
      const f = funnel.rows[0] as unknown as FunnelRow;
      const followUps = await tx.execute(sql`
        SELECT id, name, avatar_url, stage, next_follow_up_at
        FROM leads
        WHERE ${leadScope}
          AND next_follow_up_at <= ${endOfDay.toISOString()}
          AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold')
        ORDER BY next_follow_up_at ASC
        LIMIT 8
      `);
      const meetingsDue = await tx.execute(sql`
        SELECT COUNT(*)::int AS n FROM review_meetings
        WHERE tenant_id = ${session.tenantId}::uuid AND rm_id = ${session.userId}::uuid
          AND status IN ('scheduled', 'confirmed') AND meeting_date >= now() AND meeting_date < now() + interval '7 days'
      `);
      salesFunnel = {
        open: Number(f.open ?? 0),
        convertedMtd: Number(f.converted_mtd ?? 0),
        followUpsToday: Number(f.follow_ups_today ?? 0),
        leads: followUps.rows as unknown as LeadRow[],
        meetingsDue: Number((meetingsDue.rows[0] as unknown as CountRow | undefined)?.n ?? 0),
      };
    }

    return { tasks: tasks.rows as unknown as TaskRow[], research, salesFunnel };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My day</h1>
        <p className="text-muted-foreground text-sm">
          Hi {session.name.split(" ")[0]} —{" "}
          {isResearch && isSales
            ? "what you've researched and where the pipeline stands."
            : isResearch
              ? "what you've studied and produced this week."
              : "your lead pipeline and what's due today."}
        </p>
      </div>

      <div className="card-surface glass-card p-4">
        <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-3">At a glance</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {isResearch && (
            <>
              <Kpi label="Research entries" value={String(data.research!.weekCount)} sub="This week" />
              <Kpi label="Research entries" value={String(data.research!.monthCount)} sub="This month" />
            </>
          )}
          {isSales && showNav("/dashboard/leads") && (
            <>
              <Kpi label="Open leads" value={String(data.salesFunnel!.open)} sub="In pipeline" />
              <Kpi label="Converted" value={String(data.salesFunnel!.convertedMtd)} sub="This month" />
              <Kpi label="Follow-ups today" value={String(data.salesFunnel!.followUpsToday)} tone={data.salesFunnel!.followUpsToday > 0 ? "amber" : undefined} />
            </>
          )}
          {isSales && showNav("/dashboard/review-meetings") && (
            <Kpi label="Meetings this week" value={String(data.salesFunnel!.meetingsDue)} />
          )}
          {showNav("/dashboard/tasks") && <Kpi label="Open tasks" value={String(data.tasks.length)} />}
        </div>
      </div>

      {isResearch && (
        <Section title="Recent research" count={data.research!.recent.length} icon={FlaskConical}>
          {data.research!.recent.length === 0 ? (
            <DashboardEmptyState
              compact
              title="Nothing logged yet"
              hint="Log what you studied and produced in the Daily Activity Tracker — notes, reports, models."
              cta={{ href: "/dashboard/research-tracker", label: "Daily Activity Tracker" }}
            />
          ) : (
            <ul className="divide-y">
              {data.research!.recent.map((r: ResearchEntryRow) => (
                <li key={r.id} className="py-2 flex items-center justify-between text-sm gap-2">
                  <div className="min-w-0">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {r.topic ? `${r.topic} · ` : ""}
                      {formatTrackerItems(r.items, r.item_type)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.assigned_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {isSales && showNav("/dashboard/leads") && (
        <Section title="Follow-ups today" count={data.salesFunnel!.leads.length} icon={Phone}>
          {data.salesFunnel!.leads.length === 0 ? (
            <DashboardEmptyState compact title="No follow-ups due today 🎉" hint="You're caught up on the pipeline." />
          ) : (
            <ul className="divide-y">
              {data.salesFunnel!.leads.map((l: LeadRow) => (
                <li key={l.id} className="py-2 flex items-center justify-between text-sm gap-2">
                  <Link href={`/dashboard/leads/${l.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                    <Avatar src={l.avatar_url ? `/api/leads/${l.id}/avatar` : null} name={l.name} size={26} />
                    <span className="truncate">{l.name}</span>
                  </Link>
                  <span className="text-xs uppercase text-muted-foreground whitespace-nowrap">{l.stage}</span>
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

      <div className="flex flex-wrap gap-2">
        {isResearch && (
          <Link href="/dashboard/research-tracker" className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <FlaskConical className="size-3.5" /> Daily Activity Tracker
          </Link>
        )}
        {isSales && (
          <>
            {showNav("/dashboard/leads") && (
              <Link href="/dashboard/leads" className="btn-secondary text-xs inline-flex items-center gap-1.5">
                <TrendingUp className="size-3.5" /> Leads
              </Link>
            )}
            {showNav("/dashboard/proposals") && (
              <Link href="/dashboard/proposals" className="btn-secondary text-xs inline-flex items-center gap-1.5">
                <FileSignature className="size-3.5" /> Proposals
              </Link>
            )}
            {showNav("/dashboard/review-meetings") && (
              <Link href="/dashboard/review-meetings" className="btn-secondary text-xs inline-flex items-center gap-1.5">
                <CalendarClock className="size-3.5" /> Meetings
              </Link>
            )}
          </>
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
