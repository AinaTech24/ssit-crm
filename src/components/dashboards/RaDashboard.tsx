import { isMeetingParticipantSql } from "@/lib/meetings/participants";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { FlaskConical, CalendarClock, TrendingUp, FileSignature } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { istDay } from "@/lib/dates/ist";
import { FollowUpsBox, OpenTasksBox, loadMyDay, openLeadSql, totalOf } from "./MyDay";
import { ResearchCoverageSection } from "./ResearchCoverageSection";
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
type FunnelRow = { open: number | string | null; converted_mtd: number | string | null };
type CountRow = { n: number | string | null };

export async function RaDashboard({
  session,
  deskId,
  target,
  asAdmin = false,
}: {
  session: SessionUser;
  /** ?unit=d:<id> — narrows the meetings to one sub-branch. */
  deskId?: string;
  /** An admin opening one research / sales analyst's dashboard. */
  target?: { userId: string; name: string; roles: string[] };
  /** An admin viewing the research dashboard as a whole (no one person picked). */
  asAdmin?: boolean;
}) {
  const uid = target?.userId ?? session.userId;
  const viewerName = target?.name ?? session.name;
  const roleList = target?.roles ?? session.roles;
  // An admin looking at research as a whole holds neither RA role, so show the
  // research body — the team table is the point of that view.
  const isResearch = roleList.includes("ra_research") || (asAdmin && !target);
  const isSales = roleList.includes("ra_sales");

  // Only render sections for modules this firm actually has turned on — the
  // sales body's Leads/Proposals/Meetings links used to show unconditionally
  // even for a tenant without those modules enabled.
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
    // The person's own follow-ups and tasks. The admin's firm-wide research view has no "my day".
    const myDay = asAdmin && !target ? null : await loadMyDay(tx, session, uid);
    const today = istDay();

    let research: { weekCount: number; monthCount: number; recent: ResearchEntryRow[] } | null = null;
    if (isResearch) {
      // One analyst's research, or - on the admin's research view - every research analyst's.
      const owner =
        asAdmin && !target
          ? sql`owner_user_id IN (SELECT u.id FROM users u WHERE u.tenant_id = ${session.tenantId}::uuid AND 'ra_research' = ANY(u.roles))`
          : sql`owner_user_id = ${uid}::uuid`;
      const counts = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE assigned_date >= date_trunc('week', ${today}::date))::int AS week_count,
          COUNT(*) FILTER (WHERE assigned_date >= date_trunc('month', ${today}::date))::int AS month_count
        FROM activity_entries
        WHERE tenant_id = ${session.tenantId}::uuid AND ${owner} AND kind = 'research'
      `);
      const c = counts.rows[0] as unknown as ResearchCountRow;
      const recent = await tx.execute(sql`
        SELECT id, title, topic, items, item_type, status, assigned_date
        FROM activity_entries
        WHERE tenant_id = ${session.tenantId}::uuid AND ${owner} AND kind = 'research'
        ORDER BY assigned_date DESC, created_at DESC
        LIMIT 8
      `);
      research = { weekCount: Number(c.week_count ?? 0), monthCount: Number(c.month_count ?? 0), recent: recent.rows as unknown as ResearchEntryRow[] };
    }

    let salesFunnel: { open: number; convertedMtd: number; meetingsDue: number } | null = null;
    if (isSales) {
      const funnel = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE ${openLeadSql})::int AS open,
          COUNT(*) FILTER (WHERE l.converted_investor_id IS NOT NULL AND l.deleted_at IS NULL
            AND l.converted_at >= (date_trunc('month', ${today}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'))::int AS converted_mtd
        FROM leads l WHERE l.tenant_id = ${session.tenantId}::uuid AND l.owner_id = ${uid}::uuid
      `);
      const f = funnel.rows[0] as unknown as FunnelRow;
      const meetingsDue = await tx.execute(sql`
        SELECT COUNT(*)::int AS n FROM review_meetings
        WHERE tenant_id = ${session.tenantId}::uuid AND ${isMeetingParticipantSql("review_meetings", uid)}
          AND status IN ('scheduled', 'confirmed') AND meeting_date >= now() AND meeting_date < now() + interval '7 days'
      `);
      salesFunnel = {
        open: Number(f.open ?? 0),
        convertedMtd: Number(f.converted_mtd ?? 0),
        meetingsDue: Number((meetingsDue.rows[0] as unknown as CountRow | undefined)?.n ?? 0),
      };
    }

    return { myDay, research, salesFunnel };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{target ? `${target.name}'s dashboard` : asAdmin ? "Research dashboard" : "My day"}</h1>
        <p className="text-muted-foreground text-sm">
          {target || asAdmin ? "" : `Hi ${viewerName.split(" ")[0]} —`}{" "}
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
              {data.myDay && (
                <Kpi label="Follow-ups today" value={String(totalOf(data.myDay.followUps))} tone={totalOf(data.myDay.followUps) > 0 ? "amber" : undefined} />
              )}
            </>
          )}
          {isSales && showNav("/dashboard/review-meetings") && (
            <Kpi label="Meetings this week" value={String(data.salesFunnel!.meetingsDue)} />
          )}
          {showNav("/dashboard/tasks") && data.myDay && <Kpi label="Open tasks" value={String(totalOf(data.myDay.myTasks))} />}
        </div>
      </div>

      {/* Research sees meetings only — the ones handed to them and the ones
          they hand on. No clients, no client data. */}
      {/* The firm admin's research view (the whole function, or one analyst
          picked from the dashboard) does not carry this panel — only a research
          user's own dashboard does. */}
      {isResearch && !asAdmin && !target && (
        <ResearchCoverageSection session={session} deskId={deskId} userId={uid} allResearch={false} />
      )}

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

      {data.myDay && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FollowUpsBox data={data.myDay} />
          {showNav("/dashboard/tasks") && <OpenTasksBox data={data.myDay} title={target ? `${target.name.split(" ")[0]}'s open tasks` : "My open tasks"} />}
        </div>
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
