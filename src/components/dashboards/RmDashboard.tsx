import Link from "next/link";
import { Suspense } from "react";
import { and, eq, sql, desc, isNotNull, gte, lte } from "drizzle-orm";
import { Calendar, Users, TrendingUp, AlertCircle, Phone } from "lucide-react";
import { withTenant } from "@/db/client";
import { investors, leads, tasks, communications, sips } from "@/db/schema";
import { formatINR, formatRelative, formatDate } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { RmInsightsSection } from "./RmInsightsSection";
import { NbaDateFilter } from "@/components/nba/NbaDateFilter";
import { Avatar } from "@/components/ui/Avatar";
import { resolvePeriodRange } from "@/lib/dashboard/period";
import { getDashboardThresholds } from "@/lib/dashboard/thresholds";
import { DashboardEmptyState } from "@/components/dashboards/DashboardEmptyState";
import { Sparkline } from "@/components/dashboards/Sparkline";

/**
 * RM dashboard — shows only what's assigned to this RM. Per spec section 2:
 *   My leads · My clients · Today's follow-ups · Review meetings due
 *   SIP rejection follow-ups · Birthday/anniversary clients
 *   Pending service requests · SIP top-up opportunities
 *   My monthly business · My pending tasks
 */
export async function RmDashboard({
  session,
  limited = false,
  targetUserId,
  targetName,
  from,
  to,
}: {
  session: SessionUser;
  limited?: boolean;
  /** When an owner/branch-head views a specific team member's dashboard. */
  targetUserId?: string;
  targetName?: string;
  /** Date-range window (yyyy-mm-dd). Scopes the period metrics (net sales,
   *  conversions). Defaults to month-to-date when unset. */
  from?: string;
  to?: string;
}) {
  const userId = targetUserId ?? session.userId;
  const viewingOther = !!targetUserId && targetUserId !== session.userId;
  // Possessive prefix for "My X" KPI labels — owner viewing a member sees
  // "Aman's clients" instead of "My clients".
  const who = viewingOther ? `${(targetName ?? "Member").split(" ")[0]}'s` : "My";
  const today = new Date();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  const next7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  // Normalize the period window through the shared resolver so RmDashboard uses
  // the same {fromISO,toISO,label} foundation as OwnerCockpit. We still accept
  // from/to props (so existing deep-links keep working) — a given range resolves
  // as "custom"; otherwise we default to month-to-date (MTD).
  const hasRange = !!(from && /^\d{4}-\d{2}-\d{2}$/.test(from));
  const range = hasRange
    ? resolvePeriodRange("custom", today, { from, to })
    : resolvePeriodRange("mtd", today);
  const { fromISO, toISO, label: periodLabel } = range;

  // Per-tenant business thresholds (SIP-rejection look-back, etc.).
  const thresholds = getDashboardThresholds(session.tenantId);
  const sipRejectionWindowDays = thresholds.sipRejectionWindowDays;

  const data = await withTenant(session.tenantId, async (tx) => {
    // My clients + AUM
    const clientStats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS my_clients,
        COALESCE(SUM(aum::numeric), 0)::numeric AS my_aum,
        COALESCE(SUM(active_sip_amount::numeric), 0)::numeric AS my_sip_book
      FROM investors WHERE rm_id = ${userId} AND status = 'active' AND deleted_at IS NULL
    `);
    const c = clientStats.rows[0] as any;

    // My leads by stage
    const leadStats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold'))::int AS open_leads,
        COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL AND converted_at >= ${fromISO} AND converted_at <= ${toISO})::int AS converted_mtd,
        COUNT(*) FILTER (WHERE next_follow_up_at <= ${endOfDay.toISOString()} AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold'))::int AS follow_ups_today
      FROM leads WHERE owner_id = ${userId}
    `);
    const l = leadStats.rows[0] as any;

    // My monthly business (from transactions)
    const businessStats = await tx.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE 0 END), 0) AS gross,
        COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount::numeric ELSE 0 END), 0) AS redemption
      FROM transactions t
      WHERE t.status IN ('processed', 'successful')
        AND t.order_date >= ${fromISO.slice(0, 10)}::date
        AND t.order_date <= ${toISO.slice(0, 10)}::date
        AND t.investor_id IN (SELECT id FROM investors WHERE rm_id = ${userId})
    `);
    const b = businessStats.rows[0] as any;

    // Per-day net-sales series across the resolved window — drives the
    // "My net sales" hero-tile sparkline. Cheap aggregate over the same rows
    // businessStats already scans; ordered ascending so the line reads L→R.
    const netSeriesRes = await tx.execute(sql`
      SELECT t.order_date::date AS d,
             COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount::numeric ELSE 0 END), 0)
               - COALESCE(SUM(CASE WHEN t.direction = 'outflow' THEN t.amount::numeric ELSE 0 END), 0) AS net
      FROM transactions t
      WHERE t.status IN ('processed', 'successful')
        AND t.order_date >= ${fromISO.slice(0, 10)}::date
        AND t.order_date <= ${toISO.slice(0, 10)}::date
        AND t.investor_id IN (SELECT id FROM investors WHERE rm_id = ${userId})
      GROUP BY t.order_date::date
      ORDER BY t.order_date::date ASC
    `);
    const netSeries = (netSeriesRes.rows as any[]).map((r) => Number(r.net));

    // Reviews: everything already overdue, plus what falls due in the next 7
    // days. The window has no lower bound on purpose — a review missed six
    // months ago still needs doing — but it USED to be labelled "due this week"
    // with nothing distinguishing the two, so a long-overdue client read as a
    // routine one. The row now says which it is and overdue sorts first.
    const reviewsDue = await tx
      .select()
      .from(investors)
      .where(
        and(
          eq(investors.rmId, userId),
          isNotNull(investors.nextReviewAt),
          sql`next_review_at <= ${next7.toISOString()}`
        )
      )
      .orderBy(investors.nextReviewAt)
      .limit(12);

    // Today's follow-ups (leads + tasks)
    const followUps = await tx.execute(sql`
      SELECT 'lead' AS kind, id, name AS title, next_follow_up_at AS due_at FROM leads
      WHERE owner_id = ${userId} AND next_follow_up_at IS NOT NULL
        AND next_follow_up_at <= ${endOfDay.toISOString()}
        AND converted_investor_id IS NULL AND stage NOT IN ('lost', 'cold')
      UNION ALL
      SELECT 'task', id, title, due_at FROM tasks
      WHERE assignee_id = ${userId} AND status = 'open'
        AND due_at IS NOT NULL AND due_at <= ${endOfDay.toISOString()}
      ORDER BY due_at ASC LIMIT 10
    `);

    // Birthdays this week (DOB month-day matches today + 7)
    const birthdays = await tx.execute(sql`
      SELECT id, name, dob, segment_tag, avatar_url FROM investors
      WHERE rm_id = ${userId} AND dob IS NOT NULL
        AND to_char(dob, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                                       AND to_char(current_date + interval '7 days', 'MM-DD')
      LIMIT 8
    `);

    // My open tasks
    const myTasks = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.assigneeId, userId), eq(tasks.status, "open")))
      .orderBy(desc(tasks.priority), tasks.dueAt)
      .limit(8);

    // SIP top-up opportunities (HNI / Affluent with active SIPs that haven't increased in 12mo)
    const topUpRes = await tx.execute(sql`
      SELECT i.id, i.name, i.segment_tag, i.active_sip_amount, i.avatar_url
      FROM investors i
      WHERE i.rm_id = ${userId}
        AND i.segment_tag IN ('HNI', 'Affluent')
        AND i.active_sip_amount::numeric > 0
        AND NOT EXISTS (
          SELECT 1 FROM sips s
          WHERE s.investor_id = i.id
            AND s.created_at >= now() - interval '12 months'
        )
      LIMIT 5
    `);

    // Clients not MET in over 100 days. Counts actual meetings, not calls or
    // emails: a review conversation is the thing that slips quietly, and a
    // client with no meeting on record at all counts from when they onboarded
    // (otherwise the people never met once would be the only ones missing).
    const meetingOverdueRes = await tx.execute(sql`
      SELECT i.id, i.name, i.segment_tag, i.avatar_url,
             m.last_met,
             COALESCE(m.last_met, i.onboarded_at::date) AS since,
             (CURRENT_DATE - COALESCE(m.last_met, i.onboarded_at::date)) AS days_since
        FROM investors i
        LEFT JOIN LATERAL (
          SELECT MAX(rm.meeting_date)::date AS last_met
            FROM review_meetings rm
           WHERE rm.investor_id = i.id
             AND rm.tenant_id = i.tenant_id
             AND rm.status = 'completed'
        ) m ON true
       WHERE i.rm_id = ${userId}
         AND i.status = 'active'
         AND i.deleted_at IS NULL
         AND COALESCE(m.last_met, i.onboarded_at::date) IS NOT NULL
         AND COALESCE(m.last_met, i.onboarded_at::date)
             < CURRENT_DATE - ${thresholds.meetingOverdueDays}::int
       ORDER BY days_since DESC
       LIMIT 8
    `);

    // SIPs running a year or more at the same amount — the step-up conversation
    // nobody schedules. Keyed on the SIP's own start date rather than the
    // client record, so a client with one old SIP and one new one still shows
    // the old one.
    const stepUpRes = await tx.execute(sql`
      SELECT s.id, s.scheme_name, s.amount, s.start_date,
             i.id AS investor_id, i.name AS investor_name, i.avatar_url,
             (CURRENT_DATE - s.start_date::date) AS days_running
        FROM sips s
        JOIN investors i ON i.id = s.investor_id AND i.tenant_id = s.tenant_id
       WHERE i.rm_id = ${userId}
         AND i.deleted_at IS NULL
         AND s.status = 'active'
         AND s.start_date IS NOT NULL
         AND s.start_date::date <= CURRENT_DATE - INTERVAL '1 year'
         AND s.updated_at < now() - INTERVAL '1 year'
       ORDER BY s.start_date ASC
       LIMIT 8
    `);

    // Dormant money: no transaction in years. Distinct from the dormancy FLAG
    // the scanner sets (that one closes the client); this is a live nudge for
    // accounts still counted as active.
    const staleRes = await tx.execute(sql`
      SELECT i.id, i.name, i.segment_tag, i.avatar_url, i.aum, i.last_transaction_at,
             (CURRENT_DATE - i.last_transaction_at::date) AS days_since
        FROM investors i
       WHERE i.rm_id = ${userId}
         AND i.status = 'active'
         AND i.deleted_at IS NULL
         AND i.last_transaction_at IS NOT NULL
         AND i.last_transaction_at < now() - (${thresholds.staleTransactionYears}::int * INTERVAL '1 year')
       ORDER BY i.last_transaction_at ASC
       LIMIT 8
    `);

    // SIP rejection follow-ups — rejected SIPs within the configured look-back
    // window (getDashboardThresholds.sipRejectionWindowDays) for my clients.
    const sipRejections = await tx.execute(sql`
      SELECT t.id, t.scheme_name, t.amount, t.reason_code, t.created_at,
             i.id AS investor_id, i.name AS investor_name, i.avatar_url AS investor_avatar_url
      FROM transactions t
      JOIN investors i ON i.id = t.investor_id
      WHERE i.rm_id = ${userId}
        AND t.type = 'sip'
        AND t.status = 'rejected'
        AND t.created_at >= now() - make_interval(days => ${sipRejectionWindowDays})
      ORDER BY t.created_at DESC
      LIMIT 8
    `);

    // Anniversaries (investor onboarded_at month-day matches today + 7)
    const anniversaries = await tx.execute(sql`
      SELECT id, name, onboarded_at, avatar_url,
             EXTRACT(YEAR FROM age(current_date, onboarded_at))::int AS years
      FROM investors
      WHERE rm_id = ${userId} AND onboarded_at IS NOT NULL
        AND to_char(onboarded_at, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                                                AND to_char(current_date + interval '7 days', 'MM-DD')
      LIMIT 8
    `);

    // Pending service requests for assigned clients
    const myServiceReqs = await tx.execute(sql`
      SELECT sr.id, sr.ticket_no, sr.subject, sr.type, sr.status, sr.sla_resolution_at,
             i.id AS investor_id, i.name AS investor_name, i.avatar_url AS investor_avatar_url
      FROM service_requests sr
      JOIN investors i ON i.id = sr.investor_id
      WHERE i.rm_id = ${userId}
        AND sr.status IN ('open', 'in_progress')
      ORDER BY sr.sla_resolution_at ASC NULLS LAST
      LIMIT 8
    `);

    // RM personal targets — annual_target / 12 = monthly sales target
    // sip_monthly_target = monthly SIP mobilisation target
    const myTargets = await tx.execute(sql`
      SELECT
        COALESCE(annual_target::numeric, 0) AS annual_target,
        COALESCE(sip_monthly_target::numeric, 0) AS sip_monthly_target
      FROM users WHERE id = ${userId}
    `);
    const t = myTargets.rows[0] as any;
    const annualTarget = Number(t?.annual_target ?? 0);
    // Monthly sales target = annualTarget / 12; fallback 0 (no target set)
    const monthlyTarget = annualTarget > 0 ? annualTarget / 12 : 0;
    const sipMonthlyTarget = Number(t?.sip_monthly_target ?? 0);

    return {
      myClients: Number(c.my_clients),
      myAum: Number(c.my_aum),
      mySipBook: Number(c.my_sip_book),
      openLeads: Number(l.open_leads),
      convertedMtd: Number(l.converted_mtd),
      followUpsToday: Number(l.follow_ups_today),
      grossMtd: Number(b.gross),
      netMtd: Number(b.gross) - Number(b.redemption),
      netSeries,
      reviewsDue,
      followUps: followUps.rows as any[],
      birthdays: birthdays.rows as any[],
      myTasks,
      topUps: topUpRes.rows as any[],
      meetingOverdue: meetingOverdueRes.rows as any[],
      stepUps: stepUpRes.rows as any[],
      staleClients: staleRes.rows as any[],
      sipRejections: sipRejections.rows as any[],
      anniversaries: anniversaries.rows as any[],
      myServiceReqs: myServiceReqs.rows as any[],
      monthlyTarget,
      sipMonthlyTarget,
      annualTarget,
    };
  }, { userId: session.userId, branchId: session.branchId, roles: session.roles });


  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {viewingOther ? `${targetName ?? "Team member"}'s dashboard` : "Dashboard"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {viewingOther
              ? `Read-only view of ${targetName ?? "this team member"}'s book, pipeline and tasks.`
              : `Hi ${session.name.split(" ")[0]} — here's what to focus on today.`}
          </p>
        </div>
        <NbaDateFilter from={from ?? ""} to={to ?? ""} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Follow-ups today" count={data.followUps.length}>
          {data.followUps.length === 0 ? (
            <DashboardEmptyState
              compact
              title="No follow-ups due today 🎉"
              hint="You're all caught up — nothing on your plate for today."
            />
          ) : (
            <ul className="divide-y">
              {data.followUps.map((f: any) => (
                <li key={`${f.kind}-${f.id}`} className="py-2 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={f.kind === "lead" ? "pulse-warning-dot" : "pulse-danger-dot"} />
                    {f.kind === "lead" ? (
                      <Phone className="size-3.5 text-blue-600" />
                    ) : (
                      <AlertCircle className="size-3.5 text-amber-600" />
                    )}
                    <span>{f.title}</span>
                    <span className="text-xs uppercase text-muted-foreground">{f.kind}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatRelative(f.due_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* The five KPI cards used to sit in their own full-width container
            above this row. They live here now, two-across so they still read
            at half width, with the reviews list beneath them. */}
        <Section title={viewingOther ? `${targetName ?? "Team member"} at glance` : "At glance"}>
          <div className="grid grid-cols-2 gap-3">
        <Kpi label={`${who} clients`} value={String(data.myClients)} sub={formatINR(data.myAum) + " AUM"} href="/dashboard/investors" />
        <Kpi label={`${who} SIP book`} value={formatINR(data.mySipBook)} sub="per month" href="/dashboard/sips" />
        <Kpi
          label={`${who} net sales`}
          value={formatINR(data.netMtd)}
          sub={`Gross ${formatINR(data.grossMtd)} · ${periodLabel}`}
          href="/dashboard/transactions"
        >
          {data.netSeries.length >= 2 && (
            <Sparkline
              data={data.netSeries}
              className="mt-2 w-full"
              strokeClass={data.netMtd >= 0 ? "text-emerald-500" : "text-rose-500"}
            />
          )}
        </Kpi>
        <Kpi label="Open leads" value={String(data.openLeads)} sub={`${data.convertedMtd} converted · ${periodLabel}`} href="/dashboard/leads" />
        {/* Sales Quota Ring — driven by users.annual_target / 12 */}
        {data.monthlyTarget > 0 ? (
          <Link
            href="/dashboard/settings/targets"
            className="rounded-xl border bg-background/60 p-4 flex flex-col items-center justify-center text-center hover-glow-cyan transition-colors"
          >
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-2">MTD Sales Quota</div>
            <div className="relative size-16 flex items-center justify-center">
              <svg className="size-full transform -rotate-90">
                <circle
                  cx="32"
                  cy="32"
                  r="26"
                  className="stroke-slate-100 dark:stroke-slate-800 fill-none"
                  strokeWidth="5"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="26"
                  className={`fill-none ${
                    data.netMtd >= data.monthlyTarget
                      ? "stroke-emerald-500"
                      : data.netMtd >= data.monthlyTarget * 0.75
                      ? "stroke-amber-500"
                      : "stroke-brand-cyan"
                  }`}
                  strokeWidth="5"
                  strokeDasharray={`${2 * Math.PI * 26}`}
                  strokeDashoffset={`${2 * Math.PI * 26 * (1 - Math.min(100, Math.max(0, data.netMtd > 0 ? (data.netMtd / data.monthlyTarget) * 100 : 0)) / 100)}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute text-center">
                <span className={`text-xs font-bold ${
                  data.netMtd >= data.monthlyTarget ? "text-emerald-600" : "text-gradient"
                }`}>
                  {Math.min(100, Math.round(data.netMtd > 0 ? (data.netMtd / data.monthlyTarget) * 100 : 0))}%
                </span>
              </div>
            </div>
            <div className="text-[9px] text-muted-foreground mt-2 font-medium">
              Target {formatINR(data.monthlyTarget)} · Got {formatINR(data.netMtd)}
            </div>
            {data.sipMonthlyTarget > 0 && (
              <div className="text-[9px] text-muted-foreground mt-1">
                SIP target: {formatINR(data.sipMonthlyTarget)}/mo
              </div>
            )}
          </Link>
        ) : (
          <Link
            href="/dashboard/settings/targets"
            className="rounded-xl border bg-background/60 p-4 flex flex-col items-center justify-center text-center hover:bg-accent/40 transition-colors"
          >
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-2">MTD Quota</div>
            <div className="size-16 rounded-full border-2 border-dashed border-border flex items-center justify-center">
              <span className="text-xl text-muted-foreground/40">—</span>
            </div>
            <div className="text-[9px] text-brand-cyan-deep mt-2 font-semibold">
              Set your target →
            </div>
          </Link>
        )}
          </div>

          <div className="font-semibold flex items-center justify-between mt-5 mb-3 pt-4 border-t">
            <span className="text-sm font-semibold tracking-tight text-foreground/90">
              Reviews — overdue &amp; due this week
            </span>
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-xs font-semibold px-2 py-0.5">
              {data.reviewsDue.length}
            </span>
          </div>
          {data.reviewsDue.length === 0 ? (
            <DashboardEmptyState
              compact
              title="No reviews due this week 🎉"
              hint="No client portfolio reviews are scheduled in the next 7 days."
            />
          ) : (
            <ul className="divide-y">
              {data.reviewsDue.map((i) => {
                const due = i.nextReviewAt ? new Date(i.nextReviewAt as any) : null;
                const overdueDays = due
                  ? Math.floor((Date.now() - due.getTime()) / 86_400_000)
                  : 0;
                const overdue = overdueDays > 0;
                return (
                  <li key={i.id} className="py-2 flex items-center justify-between text-sm gap-2">
                    <Link href={`/dashboard/investors/${i.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                      <Avatar src={(i as any).avatarUrl ? `/api/investors/${i.id}/avatar` : null} name={i.name} size={26} />
                      <span className="truncate">{i.name}</span>
                    </Link>
                    <span className="text-xs whitespace-nowrap text-right">
                      <span className={overdue ? "text-rose-600 font-medium" : "text-muted-foreground"}>
                        {overdue ? `Overdue ${overdueDays}d` : "Upcoming"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {i.segmentTag} · {due ? formatDate(due) : "—"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <Section title={`${who} open tasks`} count={data.myTasks.length}>
        {data.myTasks.length === 0 ? (
          <DashboardEmptyState
            compact
            title="No open tasks 🎉"
            hint="Your task list is clear. Nice work staying on top of things."
          />
        ) : (
          <ul className="divide-y">
            {data.myTasks.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="size-3.5 rounded" />
                  <span>{t.title}</span>
                  <span className="text-xs uppercase text-muted-foreground">{t.priority}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t.dueAt ? formatRelative(t.dueAt) : "no due"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Not MET in over 100 days. Meetings only — a client you have emailed
            but not sat with is exactly the one this is looking for. */}
        <Section title={`Client meetings overdue (${thresholds.meetingOverdueDays}+ days)`} count={data.meetingOverdue.length}>
          {data.meetingOverdue.length === 0 ? (
            <DashboardEmptyState
              compact
              title="Everyone has been seen recently 🎉"
              hint={`No client of yours has gone ${thresholds.meetingOverdueDays} days without a completed meeting.`}
            />
          ) : (
            <ul className="divide-y">
              {data.meetingOverdue.map((c: any) => (
                <li key={c.id} className="py-2 flex items-center justify-between text-sm gap-2">
                  <Link href={`/dashboard/investors/${c.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                    <Avatar src={c.avatar_url ? `/api/investors/${c.id}/avatar` : null} name={c.name} size={26} />
                    <span className="truncate">{c.name}</span>
                  </Link>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {Number(c.days_since)} days
                    {c.last_met ? "" : " · never met"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* SIPs a year old at the same amount — the step-up nobody schedules. */}
        <Section title="SIP step-ups pending (1 yr+)" count={data.stepUps.length}>
          {data.stepUps.length === 0 ? (
            <DashboardEmptyState
              compact
              title="No step-ups pending"
              hint="No SIP of yours has been running a year or more at an unchanged amount."
            />
          ) : (
            <ul className="divide-y">
              {data.stepUps.map((sp: any) => (
                <li key={sp.id} className="py-2 flex items-center justify-between text-sm gap-2">
                  <Link href={`/dashboard/investors/${sp.investor_id}`} className="flex items-center gap-2 hover:underline min-w-0">
                    <Avatar src={sp.avatar_url ? `/api/investors/${sp.investor_id}/avatar` : null} name={sp.investor_name} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate">{sp.investor_name}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">{sp.scheme_name}</span>
                    </span>
                  </Link>
                  <span className="text-xs text-muted-foreground whitespace-nowrap text-right">
                    {formatINR(Number(sp.amount ?? 0))}/mo
                    <span className="block text-[11px]">{Math.floor(Number(sp.days_running) / 365)} yr+</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Active clients whose money has not moved in years. */}
      <Section
        title={`No transaction in ${thresholds.staleTransactionYears}+ years`}
        count={data.staleClients.length}
      >
        {data.staleClients.length === 0 ? (
          <DashboardEmptyState
            compact
            title="Every client has transacted recently"
            hint={`No active client of yours has been silent for ${thresholds.staleTransactionYears} years or more.`}
          />
        ) : (
          <ul className="divide-y">
            {data.staleClients.map((c: any) => (
              <li key={c.id} className="py-2 flex items-center justify-between text-sm gap-2">
                <Link href={`/dashboard/investors/${c.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                  <Avatar src={c.avatar_url ? `/api/investors/${c.id}/avatar` : null} name={c.name} size={26} />
                  <span className="truncate">{c.name}</span>
                </Link>
                <span className="text-xs text-muted-foreground whitespace-nowrap text-right">
                  {formatINR(Number(c.aum ?? 0))}
                  <span className="block text-[11px]">
                    last moved {c.last_transaction_at ? formatDate(c.last_transaction_at) : "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!limited && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Section title={`SIP rejection follow-ups (${sipRejectionWindowDays}d)`} count={data.sipRejections.length}>
              {data.sipRejections.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No SIP rejections to chase 🎉"
                  hint={`No SIPs were rejected for your clients in the last ${sipRejectionWindowDays} days.`}
                />
              ) : (
                <ul className="divide-y">
                  {data.sipRejections.map((r: any) => (
                    <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                      <Link href={`/dashboard/investors/${r.investor_id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={r.investor_avatar_url ? `/api/investors/${r.investor_id}/avatar` : null} name={r.investor_name} size={26} />
                        <div>
                          <div className="font-medium">{r.investor_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.scheme_name ?? "—"} · {r.reason_code ?? "unknown reason"}
                          </div>
                        </div>
                      </Link>
                      <div className="text-right">
                        <div className="text-xs text-rose-600 font-medium">{formatINR(Number(r.amount))}</div>
                        <div className="text-xs text-muted-foreground">{formatRelative(r.created_at)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Pending service requests" count={data.myServiceReqs.length}>
              {data.myServiceReqs.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No open service requests 🎉"
                  hint="None of your clients have an open or in-progress ticket."
                />
              ) : (
                <ul className="divide-y">
                  {data.myServiceReqs.map((sr: any) => {
                    const slaMs = sr.sla_resolution_at
                      ? new Date(sr.sla_resolution_at).getTime() - Date.now()
                      : null;
                    const breached = slaMs != null && slaMs < 0;
                    return (
                      <li key={sr.id} className="py-2 flex items-center justify-between text-sm">
                        <Link href="/dashboard/service-requests" className="flex items-center gap-2 hover:underline">
                          <Avatar src={sr.investor_avatar_url ? `/api/investors/${sr.investor_id}/avatar` : null} name={sr.investor_name} size={26} />
                          <div>
                            <div className="font-medium">{sr.subject}</div>
                            <div className="text-xs text-muted-foreground">
                              {sr.investor_name} · {sr.type}
                            </div>
                          </div>
                        </Link>
                        <span className={`text-xs ${breached ? "text-rose-600 font-medium" : "text-muted-foreground"}`}>
                          {breached ? "SLA breached" : sr.status}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Section title="Birthdays this week" count={data.birthdays.length}>
              {data.birthdays.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No birthdays this week"
                  hint="No client birthdays fall in the next 7 days."
                />
              ) : (
                <ul className="divide-y">
                  {data.birthdays.map((b: any) => (
                    <li key={b.id} className="py-2 flex items-center justify-between text-sm">
                      <Link href={`/dashboard/investors/${b.id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={b.avatar_url ? `/api/investors/${b.id}/avatar` : null} name={b.name} size={26} />
                        <span>{b.name}</span>
                      </Link>
                      <span className="text-xs text-muted-foreground">{formatDate(b.dob)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Anniversaries this week" count={data.anniversaries.length}>
              {data.anniversaries.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No anniversaries this week"
                  hint="No client onboarding anniversaries fall in the next 7 days."
                />
              ) : (
                <ul className="divide-y">
                  {data.anniversaries.map((a: any) => (
                    <li key={a.id} className="py-2 flex items-center justify-between text-sm">
                      <Link href={`/dashboard/investors/${a.id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={a.avatar_url ? `/api/investors/${a.id}/avatar` : null} name={a.name} size={26} />
                        <span>{a.name}</span>
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {a.years > 0 ? `${a.years} yr` : "today"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="SIP top-up opportunities" count={data.topUps.length}>
              {data.topUps.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No top-up opportunities right now"
                  hint="No HNI/Affluent clients are due for a SIP step-up at the moment."
                />
              ) : (
                <ul className="divide-y">
                  {data.topUps.map((t: any) => (
                    <li key={t.id} className="py-2 flex items-center justify-between text-sm">
                      <Link href={`/dashboard/investors/${t.id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={t.avatar_url ? `/api/investors/${t.id}/avatar` : null} name={t.name} size={26} />
                        <span>{t.name}</span>
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {t.segment_tag} · {formatINR(Number(t.active_sip_amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}


      {/* ---------- RM Insights — service-first cockpit additions ---------- */}
      {/* Streamed, not awaited inline: RmInsightsSection runs seven more
          queries, and blocking on them meant a big book (150+ clients) stared
          at a blank page until ALL of this dashboard's ~20 round-trips had
          finished. Behind Suspense the cockpit above paints as soon as its own
          data lands and the insights fill in after. RmInsightsSafe keeps the
          error containment — see the note on it. */}
      {!limited && (
        <Suspense fallback={<InsightsSkeleton />}>
          <RmInsightsSafe session={session} targetUserId={targetUserId} />
        </Suspense>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  href,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  /** When set, the whole tile links to the module it summarizes. */
  href?: string;
  children?: React.ReactNode;
}) {
  const inner = (
    <div className="rounded-xl border bg-background/60 p-4 hover-glow-cyan transition-colors h-full">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-2 tracking-tight text-gradient">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1 font-medium">{sub}</div>}
      {children}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="card-surface glass-card p-5">
      <div className="font-semibold flex items-center justify-between mb-3">
        <span className="text-sm font-semibold tracking-tight text-foreground/90">{title}</span>
        {count !== undefined && (
          <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-xs font-semibold px-2 py-0.5">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * RmInsightsSection with its own error containment, as a component so it can
 * sit behind <Suspense> and stream.
 *
 * The try/catch has to live INSIDE an async component like this. Writing
 * `<RmInsightsSection />` at the call site only builds an element — its async
 * body runs later, when React walks the tree, long past any try/catch up
 * there — which is exactly how a single unparsable lead amount once took the
 * whole dashboard down. Awaiting it here catches it and degrades to one dead
 * card instead.
 */
async function RmInsightsSafe({
  session,
  targetUserId,
}: {
  session: SessionUser;
  targetUserId?: string;
}) {
  try {
    return await RmInsightsSection({ session, targetUserId });
  } catch (err) {
    console.error("[RmDashboard] RmInsightsSection failed, omitting section", {
      userId: session.userId,
      tenantId: session.tenantId,
      targetUserId,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    return (
      <div className="card-surface glass-card p-5 text-sm text-muted-foreground">
        This section couldn&apos;t load right now.
      </div>
    );
  }
}

function InsightsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-28 rounded-xl bg-card border border-border/50 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-44 rounded-xl bg-card border border-border/50 animate-pulse" />
        <div className="h-44 rounded-xl bg-card border border-border/50 animate-pulse" />
      </div>
    </div>
  );
}
