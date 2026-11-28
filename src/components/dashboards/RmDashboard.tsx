import Link from "next/link";
import { Suspense } from "react";
import { sql, type SQL } from "drizzle-orm";
import { Calendar, Users, TrendingUp, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { SIP_OPEN_STATUSES } from "@/db/schema/sip_rejections";
import { FollowUpsBox, OpenTasksBox, ScrollList, Section, loadMyDay, openLeadSql, totalOf } from "./MyDay";
import { istDayBounds } from "@/lib/dates/ist";
import { formatINR, formatDate } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { RmInsightsSection } from "./RmInsightsSection";
import { SipIssuesCard } from "./SipIssuesCard";
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
  // "Today" is the Indian calendar day.
  const { day: todayStr, start: dayStart, end: dayEnd } = istDayBounds();
  const weekEnd = new Date(dayEnd.getTime() + 7 * 86_400_000);
  const monthStartDay = `${todayStr.slice(0, 7)}-01`;
  // Normalize the period window through the shared resolver so RmDashboard uses
  // the same {fromISO,toISO,label} foundation as OwnerCockpit. We still accept
  // from/to props (so existing deep-links keep working) — a given range resolves
  // as "custom"; otherwise we default to month-to-date (MTD).
  const hasRange = !!(from && /^\d{4}-\d{2}-\d{2}$/.test(from));
  const range = hasRange
    ? resolvePeriodRange("custom", today, { from, to })
    : resolvePeriodRange("mtd", today);
  const { fromISO, toISO, fromDay, toDay, label: periodLabel } = range;

  // Per-tenant business thresholds (SIP-rejection look-back, etc.).
  const thresholds = getDashboardThresholds(session.tenantId);
  const sipRejectionWindowDays = thresholds.sipRejectionWindowDays;
  // Lists scroll; the number beside each title is always the true total (COUNT(*) OVER ()).
  const LIST_CAP = 200;

  const data = await withTenant(session.tenantId, async (tx) => {
    const rowsOf = async (q: SQL) => (await tx.execute(q)).rows as any[];
    const myClient = sql`i.rm_id = ${userId}::uuid AND i.deleted_at IS NULL AND i.status = 'active'`;

    // My clients + AUM
    const [c] = await rowsOf(sql`
      SELECT
        COUNT(*)::int AS my_clients,
        COALESCE(SUM(i.aum::numeric), 0)::numeric AS my_aum,
        COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS my_sip_book
      FROM investors i WHERE ${myClient}
    `);

    // My leads
    const [l] = await rowsOf(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${openLeadSql})::int AS open_leads,
        COUNT(*) FILTER (WHERE l.converted_investor_id IS NOT NULL AND l.deleted_at IS NULL
          AND l.converted_at >= ${fromISO} AND l.converted_at <= ${toISO})::int AS converted_in_period
      FROM leads l WHERE l.owner_id = ${userId}::uuid
    `);

    // My business, from the Transactions entries I am the RM of (what the firm actually books).
    const mine = sql`e.tenant_id = ${session.tenantId}::uuid AND e.rm_id = ${userId}::uuid
      AND e.status <> 'cancelled' AND e.deleted_at IS NULL`;
    const bought = sql`ln.txn_type IN ('sip', 'sip_topup', 'lumpsum', 'additional_purchase')`;
    const sold = sql`ln.txn_type IN ('redemption', 'swp')`;
    const sums = sql`
      COALESCE(SUM(ln.amount::numeric) FILTER (WHERE ${bought}), 0) AS gross,
      COALESCE(SUM(ln.amount::numeric) FILTER (WHERE ${sold}), 0) AS redemption,
      COALESCE(SUM(ln.amount::numeric) FILTER (WHERE ln.txn_type IN ('sip', 'sip_topup')), 0) AS sip_booked`;
    const lines = sql`business_entry_lines ln JOIN business_entries e ON e.id = ln.entry_id`;
    const [b] = await rowsOf(sql`
      SELECT ${sums} FROM ${lines}
       WHERE ${mine} AND e.business_date >= ${fromDay}::date AND e.business_date <= ${toDay}::date
    `);
    // The quota ring is always month-to-date, whatever range is picked above.
    const [month] = await rowsOf(sql`
      SELECT ${sums} FROM ${lines}
       WHERE ${mine} AND e.business_date >= ${monthStartDay}::date AND e.business_date <= ${todayStr}::date
    `);
    const series = await rowsOf(sql`
      SELECT e.business_date AS d, ${sums} FROM ${lines}
       WHERE ${mine} AND e.business_date >= ${fromDay}::date AND e.business_date <= ${toDay}::date
       GROUP BY e.business_date ORDER BY e.business_date ASC
    `);
    const netSeries = series.map((r) => Number(r.gross) - Number(r.redemption));

    // Reviews: everything already overdue, plus what falls due in the next 7 days.
    const reviewsDue = await rowsOf(sql`
      SELECT i.id, i.name, i.segment_tag, i.avatar_url, i.next_review_at, COUNT(*) OVER ()::int AS total_count
        FROM investors i
       WHERE ${myClient} AND i.next_review_at IS NOT NULL AND i.next_review_at < ${weekEnd}
       ORDER BY i.next_review_at ASC LIMIT ${LIST_CAP}
    `);

    // Today's follow-ups, earlier overdue ones and every open task.
    const myDay = await loadMyDay(tx, session, userId);

    // Birthdays in the next 7 days (works across the year end).
    const birthdays = await rowsOf(sql`
      SELECT i.id, i.name, i.dob, i.segment_tag, i.avatar_url, COUNT(*) OVER ()::int AS total_count
        FROM investors i
        JOIN generate_series(0, 7) g(n) ON to_char(${todayStr}::date + g.n, 'MM-DD') = to_char(i.dob, 'MM-DD')
       WHERE ${myClient} AND i.dob IS NOT NULL
       ORDER BY g.n, i.name LIMIT ${LIST_CAP}
    `);

    // SIP top-up opportunities (HNI / Affluent with active SIPs that haven't increased in 12mo)
    const topUps = await rowsOf(sql`
      SELECT i.id, i.name, i.segment_tag, i.active_sip_amount, i.avatar_url, COUNT(*) OVER ()::int AS total_count
        FROM investors i
       WHERE ${myClient}
         AND i.segment_tag IN ('HNI', 'Affluent')
         AND i.active_sip_amount::numeric > 0
         AND NOT EXISTS (
           SELECT 1 FROM sips s
            WHERE s.investor_id = i.id AND s.created_at >= now() - interval '12 months'
         )
       ORDER BY i.active_sip_amount::numeric DESC LIMIT ${LIST_CAP}
    `);

    // Clients not MET in over 100 days. Counts actual meetings, not calls or
    // emails: a review conversation is the thing that slips quietly, and a
    // client with no meeting on record at all counts from when they onboarded
    // (otherwise the people never met once would be the only ones missing).
    const meetingOverdue = await rowsOf(sql`
      SELECT i.id, i.name, i.segment_tag, i.avatar_url,
             m.last_met,
             (${todayStr}::date - COALESCE(m.last_met, i.onboarded_at::date)) AS days_since,
             COUNT(*) OVER ()::int AS total_count
        FROM investors i
        LEFT JOIN LATERAL (
          SELECT MAX(rm.meeting_date)::date AS last_met
            FROM review_meetings rm
           WHERE rm.investor_id = i.id
             AND rm.tenant_id = i.tenant_id
             AND rm.status = 'completed'
        ) m ON true
       WHERE ${myClient}
         AND COALESCE(m.last_met, i.onboarded_at::date) IS NOT NULL
         AND COALESCE(m.last_met, i.onboarded_at::date)
             < ${todayStr}::date - ${thresholds.meetingOverdueDays}::int
       ORDER BY days_since DESC
       LIMIT ${LIST_CAP}
    `);

    // SIPs running a year or more at the same amount — the step-up conversation
    // nobody schedules. Keyed on the SIP's own start date rather than the
    // client record, so a client with one old SIP and one new one still shows
    // the old one.
    const stepUps = await rowsOf(sql`
      SELECT s.id, s.scheme_name, s.amount, s.start_date,
             i.id AS investor_id, i.name AS investor_name, i.avatar_url,
             (${todayStr}::date - s.start_date::date) AS days_running,
             COUNT(*) OVER ()::int AS total_count
        FROM sips s
        JOIN investors i ON i.id = s.investor_id AND i.tenant_id = s.tenant_id
       WHERE ${myClient}
         AND s.status = 'active'
         AND s.start_date IS NOT NULL
         AND s.start_date::date <= ${todayStr}::date - INTERVAL '1 year'
         AND s.updated_at < now() - INTERVAL '1 year'
       ORDER BY s.start_date ASC
       LIMIT ${LIST_CAP}
    `);

    // Dormant money: no transaction in years. Distinct from the dormancy FLAG
    // the scanner sets (that one closes the client); this is a live nudge for
    // accounts still counted as active.
    const staleClients = await rowsOf(sql`
      SELECT i.id, i.name, i.segment_tag, i.avatar_url, i.aum, i.last_transaction_at, COUNT(*) OVER ()::int AS total_count
        FROM investors i
       WHERE ${myClient}
         AND i.last_transaction_at IS NOT NULL
         AND i.last_transaction_at < now() - (${thresholds.staleTransactionYears}::int * INTERVAL '1 year')
       ORDER BY i.last_transaction_at ASC
       LIMIT ${LIST_CAP}
    `);

    // Rejected SIPs still to be recovered (the SIP rejections register), within the look-back window.
    const sipRejections = await rowsOf(sql`
      SELECT r.id, r.scheme_name, r.rejection_amount AS amount, r.rejection_reason, r.rejection_date,
             i.id AS investor_id, i.name AS investor_name, i.avatar_url AS investor_avatar_url,
             COUNT(*) OVER ()::int AS total_count
        FROM sip_rejections r
        JOIN investors i ON i.id = r.investor_id
       WHERE r.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL
         AND (r.assigned_rm_id = ${userId}::uuid OR i.rm_id = ${userId}::uuid)
         AND r.recovery_status IN (${sql.join(SIP_OPEN_STATUSES.map((s) => sql`${s}`), sql`, `)})
         AND r.rejection_date >= ${todayStr}::date - ${sipRejectionWindowDays}::int
       ORDER BY r.rejection_date DESC
       LIMIT ${LIST_CAP}
    `);

    // Onboarding anniversaries in the next 7 days (works across the year end).
    const anniversaries = await rowsOf(sql`
      SELECT i.id, i.name, i.avatar_url,
             (EXTRACT(YEAR FROM ${todayStr}::date + g.n) - EXTRACT(YEAR FROM i.onboarded_at))::int AS years,
             g.n AS days_away, COUNT(*) OVER ()::int AS total_count
        FROM investors i
        JOIN generate_series(0, 7) g(n) ON to_char(${todayStr}::date + g.n, 'MM-DD') = to_char(i.onboarded_at, 'MM-DD')
       WHERE ${myClient} AND i.onboarded_at IS NOT NULL
         AND EXTRACT(YEAR FROM ${todayStr}::date + g.n) > EXTRACT(YEAR FROM i.onboarded_at)
       ORDER BY g.n, i.name LIMIT ${LIST_CAP}
    `);

    // Service requests still open: my clients', or assigned to me.
    const myServiceReqs = await rowsOf(sql`
      SELECT sr.id, sr.ticket_no, sr.subject, sr.type, sr.status, sr.sla_resolution_at,
             i.id AS investor_id, COALESCE(i.name, sr.client_name) AS investor_name, i.avatar_url AS investor_avatar_url,
             COUNT(*) OVER ()::int AS total_count
        FROM service_requests sr
        LEFT JOIN investors i ON i.id = sr.investor_id
       WHERE sr.tenant_id = ${session.tenantId}::uuid
         AND (i.rm_id = ${userId}::uuid OR sr.assigned_to_user_id = ${userId}::uuid)
         AND sr.status IN ('open', 'in_progress', 'waiting_customer', 'escalated')
       ORDER BY sr.sla_resolution_at ASC NULLS LAST
       LIMIT ${LIST_CAP}
    `);

    // RM personal targets — annual_target / 12 = monthly sales target
    // sip_monthly_target = monthly SIP mobilisation target
    const [t] = await rowsOf(sql`
      SELECT
        COALESCE(annual_target::numeric, 0) AS annual_target,
        COALESCE(sip_monthly_target::numeric, 0) AS sip_monthly_target
      FROM users WHERE id = ${userId}::uuid
    `);
    const annualTarget = Number(t?.annual_target ?? 0);

    return {
      myClients: Number(c.my_clients),
      myAum: Number(c.my_aum),
      mySipBook: Number(c.my_sip_book),
      openLeads: Number(l.open_leads),
      converted: Number(l.converted_in_period),
      gross: Number(b.gross),
      net: Number(b.gross) - Number(b.redemption),
      sipBooked: Number(b.sip_booked),
      netMonth: Number(month.gross) - Number(month.redemption),
      netSeries,
      reviewsDue,
      myDay,
      birthdays,
      topUps,
      meetingOverdue,
      stepUps,
      staleClients,
      sipRejections,
      anniversaries,
      myServiceReqs,
      // Monthly sales target = annualTarget / 12; 0 = no target set
      monthlyTarget: annualTarget > 0 ? annualTarget / 12 : 0,
      sipMonthlyTarget: Number(t?.sip_monthly_target ?? 0),
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
        <FollowUpsBox data={data.myDay} />

        {/* The five KPI cards used to sit in their own full-width container
            above this row. They live here now, two-across so they still read
            at half width, with the reviews list beneath them. */}
        <Section title={viewingOther ? `${targetName ?? "Team member"} at glance` : "At glance"}>
          <div className="grid grid-cols-2 gap-3">
        <Kpi label={`${who} clients`} value={String(data.myClients)} sub={formatINR(data.myAum) + " AUM"} href="/dashboard/investors" />
        <Kpi label={`${who} SIP book`} value={formatINR(data.mySipBook)} sub={data.sipBooked > 0 ? `per month · ${formatINR(data.sipBooked)} SIP booked · ${periodLabel}` : "per month"} href="/dashboard/sips" />
        <Kpi
          label={`${who} net sales`}
          value={formatINR(data.net)}
          sub={`Gross ${formatINR(data.gross)} · ${periodLabel}`}
          href="/dashboard/business-entries"
        >
          {data.netSeries.length >= 2 && (
            <Sparkline
              data={data.netSeries}
              className="mt-2 w-full"
              strokeClass={data.net >= 0 ? "text-emerald-500" : "text-rose-500"}
            />
          )}
        </Kpi>
        <Kpi label="Open leads" value={String(data.openLeads)} sub={`${data.converted} converted · ${periodLabel}`} href="/dashboard/leads" />
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
                    data.netMonth >= data.monthlyTarget
                      ? "stroke-emerald-500"
                      : data.netMonth >= data.monthlyTarget * 0.75
                      ? "stroke-amber-500"
                      : "stroke-brand-cyan"
                  }`}
                  strokeWidth="5"
                  strokeDasharray={`${2 * Math.PI * 26}`}
                  strokeDashoffset={`${2 * Math.PI * 26 * (1 - Math.min(100, Math.max(0, data.netMonth > 0 ? (data.netMonth / data.monthlyTarget) * 100 : 0)) / 100)}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute text-center">
                <span className={`text-xs font-bold ${
                  data.netMonth >= data.monthlyTarget ? "text-emerald-600" : "text-gradient"
                }`}>
                  {Math.min(100, Math.round(data.netMonth > 0 ? (data.netMonth / data.monthlyTarget) * 100 : 0))}%
                </span>
              </div>
            </div>
            <div className="text-[9px] text-muted-foreground mt-2 font-medium">
              Target {formatINR(data.monthlyTarget)} · Got {formatINR(data.netMonth)}
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
              {totalOf(data.reviewsDue)}
            </span>
          </div>
          {data.reviewsDue.length === 0 ? (
            <DashboardEmptyState
              compact
              title="No reviews due this week 🎉"
              hint="No client portfolio reviews are scheduled in the next 7 days."
            />
          ) : (
            <ScrollList>
              {data.reviewsDue.map((i: any) => {
                const due = i.next_review_at ? new Date(i.next_review_at) : null;
                const overdueDays = due
                  ? Math.floor((dayStart.getTime() - due.getTime()) / 86_400_000) + 1
                  : 0;
                const overdue = overdueDays > 0;
                return (
                  <li key={i.id} className="py-2 flex items-center justify-between text-sm gap-2">
                    <Link href={`/dashboard/investors/${i.id}`} className="flex items-center gap-2 hover:underline min-w-0">
                      <Avatar src={i.avatar_url ? `/api/investors/${i.id}/avatar` : null} name={i.name} size={26} />
                      <span className="truncate">{i.name}</span>
                    </Link>
                    <span className="text-xs whitespace-nowrap text-right">
                      <span className={overdue ? "text-rose-600 font-medium" : "text-muted-foreground"}>
                        {overdue ? `Overdue ${overdueDays}d` : "Upcoming"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {i.segment_tag} · {due ? formatDate(due) : "—"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ScrollList>
          )}
        </Section>
      </div>

      <OpenTasksBox data={data.myDay} title={`${who} open tasks`} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Not MET in over 100 days. Meetings only — a client you have emailed
            but not sat with is exactly the one this is looking for. */}
        <Section title={`Client meetings overdue (${thresholds.meetingOverdueDays}+ days)`} count={totalOf(data.meetingOverdue)}>
          {data.meetingOverdue.length === 0 ? (
            <DashboardEmptyState
              compact
              title="Everyone has been seen recently 🎉"
              hint={`No client of yours has gone ${thresholds.meetingOverdueDays} days without a completed meeting.`}
            />
          ) : (
            <ScrollList>
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
            </ScrollList>
          )}
        </Section>

        {/* SIPs a year old at the same amount — the step-up nobody schedules. */}
        <Section title="SIP step-ups pending (1 yr+)" count={totalOf(data.stepUps)}>
          {data.stepUps.length === 0 ? (
            <DashboardEmptyState
              compact
              title="No step-ups pending"
              hint="No SIP of yours has been running a year or more at an unchanged amount."
            />
          ) : (
            <ScrollList>
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
            </ScrollList>
          )}
        </Section>
      </div>

      {/* Active clients whose money has not moved in years. */}
      <Section
        title={`No transaction in ${thresholds.staleTransactionYears}+ years`}
        count={totalOf(data.staleClients)}
      >
        {data.staleClients.length === 0 ? (
          <DashboardEmptyState
            compact
            title="Every client has transacted recently"
            hint={`No active client of yours has been silent for ${thresholds.staleTransactionYears} years or more.`}
          />
        ) : (
          <ScrollList>
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
          </ScrollList>
        )}
      </Section>

      {!limited && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Section title={`SIP rejection follow-ups (${sipRejectionWindowDays}d)`} count={totalOf(data.sipRejections)}>
              {data.sipRejections.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No SIP rejections to chase 🎉"
                  hint={`No SIPs were rejected for your clients in the last ${sipRejectionWindowDays} days.`}
                />
              ) : (
                <ScrollList>
                  {data.sipRejections.map((r: any) => (
                    <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                      <Link href={`/dashboard/investors/${r.investor_id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={r.investor_avatar_url ? `/api/investors/${r.investor_id}/avatar` : null} name={r.investor_name} size={26} />
                        <div>
                          <div className="font-medium">{r.investor_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.scheme_name ?? "—"} · {r.rejection_reason ?? "unknown reason"}
                          </div>
                        </div>
                      </Link>
                      <div className="text-right">
                        <div className="text-xs text-rose-600 font-medium">{formatINR(Number(r.amount))}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(r.rejection_date)}</div>
                      </div>
                    </li>
                  ))}
                </ScrollList>
              )}
            </Section>

            <Section title="Pending service requests" count={totalOf(data.myServiceReqs)}>
              {data.myServiceReqs.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No open service requests 🎉"
                  hint="None of your clients have an open or in-progress ticket."
                />
              ) : (
                <ScrollList>
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
                </ScrollList>
              )}
            </Section>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Section title="Birthdays this week" count={totalOf(data.birthdays)}>
              {data.birthdays.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No birthdays this week"
                  hint="No client birthdays fall in the next 7 days."
                />
              ) : (
                <ScrollList>
                  {data.birthdays.map((b: any) => (
                    <li key={b.id} className="py-2 flex items-center justify-between text-sm">
                      <Link href={`/dashboard/investors/${b.id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={b.avatar_url ? `/api/investors/${b.id}/avatar` : null} name={b.name} size={26} />
                        <span>{b.name}</span>
                      </Link>
                      <span className="text-xs text-muted-foreground">{formatDate(b.dob)}</span>
                    </li>
                  ))}
                </ScrollList>
              )}
            </Section>

            <Section title="Anniversaries this week" count={totalOf(data.anniversaries)}>
              {data.anniversaries.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No anniversaries this week"
                  hint="No client onboarding anniversaries fall in the next 7 days."
                />
              ) : (
                <ScrollList>
                  {data.anniversaries.map((a: any) => (
                    <li key={a.id} className="py-2 flex items-center justify-between text-sm">
                      <Link href={`/dashboard/investors/${a.id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={a.avatar_url ? `/api/investors/${a.id}/avatar` : null} name={a.name} size={26} />
                        <span>{a.name}</span>
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {a.years} yr · {Number(a.days_away) === 0 ? "today" : Number(a.days_away) === 1 ? "tomorrow" : `in ${a.days_away} days`}
                      </span>
                    </li>
                  ))}
                </ScrollList>
              )}
            </Section>

            <Section title="SIP top-up opportunities" count={totalOf(data.topUps)}>
              {data.topUps.length === 0 ? (
                <DashboardEmptyState
                  compact
                  title="No top-up opportunities right now"
                  hint="No HNI/Affluent clients are due for a SIP step-up at the moment."
                />
              ) : (
                <ScrollList>
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
                </ScrollList>
              )}
            </Section>
          </div>
        </>
      )}


      {!limited && (
        <Suspense fallback={null}>
          <SipIssuesCard session={session} targetUserId={userId} />
        </Suspense>
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
