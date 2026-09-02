/**
 * Team Dashboard aggregation — the manager's "how is my team doing + who's
 * accountable" view, modelled on three lenses:
 *
 *   OPEN     — pending workload right now (overdues, due-today, open leads ₹,
 *              meetings, service requests, SIP bounces)
 *   PERIODIC — activity that happened today (created / completed / added)
 *   RESULT   — outcomes over a date range (completed tasks, converted vs lost
 *              leads with ₹, completed meetings, new clients + AUM)
 *
 * Plus a per-RM accountability roll-up (who owns the overdues / pipeline /
 * results) — the drill-down that turns a firm number into a person.
 *
 * Read-only, tenant-scoped via RLS (withTenant). Every metric carries a deep
 * link to the already-filtered module list so a click lands on the records.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type Metric = {
  key: string;
  label: string;
  count: number;
  amount?: number; // INR, when the bucket is money-weighted
  href: string;
  tone?: "rose" | "amber" | "emerald" | "violet" | "sky";
};

export type RmRow = {
  id: string;
  name: string;
  overdueTasks: number;
  dueTodayTasks: number;
  openLeads: number;
  openLeadsAmt: number;
  completedTasks: number;
  convertedLeads: number;
  convertedAmt: number;
};

export type TeamDashboard = {
  open: Metric[];
  periodic: Metric[];
  result: Metric[];
  perRm: RmRow[];
  range: { from: string; to: string };
};

// Parse the free-text lead "intended amount" into numeric rupees.
const AMT = (col: string) =>
  sql.raw(`COALESCE(SUM(NULLIF(regexp_replace(COALESCE(${col},''),'[^0-9.]','','g'),'')::numeric),0)`);

const OPEN_LEAD_STAGES = sql.raw(
  `stage NOT IN ('not_qualified','lost','not_interested','converted')`
);

export async function getTeamDashboard(
  tx: Tx,
  opts: {
    fromISO: string;
    toEndISO: string;
    rangeLabel: { from: string; to: string };
    /** When set, scope every metric + the per-RM table to this team member. */
    memberId?: string;
  }
): Promise<TeamDashboard> {
  const { fromISO, toEndISO } = opts;

  // Per-entity owner predicate, injected into each subquery's WHERE. Empty
  // (firm-wide) when no member is selected. Indirect owners (sips, insurance)
  // resolve through the investor's RM.
  const member = opts.memberId?.trim() || null;
  const taskWho = member ? sql` AND assignee_id = ${member}::uuid` : sql``;
  const leadWho = member ? sql` AND owner_id = ${member}::uuid` : sql``;
  const meetWho = member ? sql` AND rm_id = ${member}::uuid` : sql``;
  const srWho = member ? sql` AND assigned_to_user_id = ${member}::uuid` : sql``;
  const invWho = member ? sql` AND rm_id = ${member}::uuid` : sql``;
  const investorOf = member
    ? sql` AND investor_id IN (SELECT id FROM investors WHERE rm_id = ${member}::uuid AND deleted_at IS NULL)`
    : sql``;
  const actWho = member ? sql` AND owner_user_id = ${member}::uuid` : sql``;
  // Deep-link suffix so a tile lands on the member-filtered module list.
  const qp = (key: string) => (member ? `?${key}=${member}` : "");

  // ── OPEN (current state) ─────────────────────────────────────────────
  const o = (
    await tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM tasks
           WHERE status IN ('open','in_progress','blocked')
             AND due_at IS NOT NULL AND due_at < now()${taskWho}) AS overdue_tasks,
        (SELECT count(*)::int FROM tasks
           WHERE status IN ('open','in_progress','blocked')
             AND due_at::date = current_date${taskWho}) AS due_today_tasks,
        (SELECT count(*)::int FROM tasks
           WHERE status IN ('open','in_progress','blocked')${taskWho}) AS open_tasks,
        (SELECT count(*)::int FROM leads
           WHERE converted_investor_id IS NULL AND ${OPEN_LEAD_STAGES}${leadWho}) AS open_leads,
        (SELECT ${AMT("intended_amount")} FROM leads
           WHERE converted_investor_id IS NULL AND ${OPEN_LEAD_STAGES}${leadWho}) AS open_leads_amt,
        (SELECT count(*)::int FROM leads
           WHERE converted_investor_id IS NULL AND ${OPEN_LEAD_STAGES}
             AND next_follow_up_at IS NOT NULL AND next_follow_up_at < now()${leadWho}) AS overdue_followups,
        (SELECT count(*)::int FROM review_meetings
           WHERE status IN ('scheduled','rescheduled')${meetWho}) AS open_meetings,
        (SELECT count(*)::int FROM service_requests
           WHERE status IN ('open','in_progress','waiting_customer','escalated')${srWho}) AS open_srs,
        (SELECT count(*)::int FROM sips WHERE status = 'rejected'${investorOf}) AS sip_rejections,
        (SELECT count(*)::int FROM insurance_policies
           WHERE status = 'active' AND next_premium_due_date IS NOT NULL
             AND next_premium_due_date >= current_date
             AND next_premium_due_date <= current_date + 30${investorOf}) AS insurance_renewals,
        (SELECT count(*)::int FROM activities
           WHERE next_followup_at IS NOT NULL AND next_followup_at < now()${actWho}) AS activity_followups
    `)
  ).rows[0] as any;

  // ── PERIODIC (today) ─────────────────────────────────────────────────
  const p = (
    await tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM tasks WHERE created_at::date = current_date${taskWho}) AS tasks_created,
        (SELECT count(*)::int FROM tasks WHERE status='completed' AND updated_at::date = current_date${taskWho}) AS tasks_completed,
        (SELECT count(*)::int FROM leads WHERE created_at::date = current_date${leadWho}) AS leads_added,
        (SELECT ${AMT("intended_amount")} FROM leads WHERE created_at::date = current_date${leadWho}) AS leads_added_amt,
        (SELECT count(*)::int FROM review_meetings WHERE meeting_date::date = current_date${meetWho}) AS meetings_today,
        (SELECT count(*)::int FROM investors WHERE deleted_at IS NULL AND created_at::date = current_date${invWho}) AS clients_added,
        (SELECT count(*)::int FROM activities WHERE kind = 'call' AND occurred_at::date = current_date${actWho}) AS calls_today,
        (SELECT count(*)::int FROM activities WHERE kind = 'visit' AND occurred_at::date = current_date${actWho}) AS visits_today
    `)
  ).rows[0] as any;

  // ── RESULT (range) ───────────────────────────────────────────────────
  const r = (
    await tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM tasks
           WHERE status='completed' AND updated_at >= ${fromISO} AND updated_at < ${toEndISO}${taskWho}) AS completed_tasks,
        (SELECT count(*)::int FROM leads
           WHERE converted_at IS NOT NULL AND converted_at >= ${fromISO} AND converted_at < ${toEndISO}${leadWho}) AS converted_leads,
        (SELECT ${AMT("intended_amount")} FROM leads
           WHERE converted_at IS NOT NULL AND converted_at >= ${fromISO} AND converted_at < ${toEndISO}${leadWho}) AS converted_amt,
        (SELECT count(*)::int FROM leads
           WHERE lost_at IS NOT NULL AND lost_at >= ${fromISO} AND lost_at < ${toEndISO}${leadWho}) AS lost_leads,
        (SELECT ${AMT("intended_amount")} FROM leads
           WHERE lost_at IS NOT NULL AND lost_at >= ${fromISO} AND lost_at < ${toEndISO}${leadWho}) AS lost_amt,
        (SELECT count(*)::int FROM review_meetings
           WHERE status='completed' AND meeting_date >= ${fromISO} AND meeting_date < ${toEndISO}${meetWho}) AS completed_meetings,
        (SELECT count(*)::int FROM investors
           WHERE deleted_at IS NULL AND onboarded_at IS NOT NULL AND onboarded_at >= ${fromISO} AND onboarded_at < ${toEndISO}${invWho}) AS new_clients,
        (SELECT COALESCE(SUM(aum),0) FROM investors
           WHERE deleted_at IS NULL AND onboarded_at IS NOT NULL AND onboarded_at >= ${fromISO} AND onboarded_at < ${toEndISO}${invWho}) AS new_aum
    `)
  ).rows[0] as any;

  const num = (v: any) => Number(v ?? 0);

  const open: Metric[] = [
    { key: "overdue_tasks", label: "Overdue tasks", count: num(o.overdue_tasks), href: `/dashboard/tasks${qp("assignee")}`, tone: "rose" },
    { key: "overdue_followups", label: "Overdue follow-ups", count: num(o.overdue_followups), href: `/dashboard/leads${qp("owner")}`, tone: "rose" },
    { key: "due_today_tasks", label: "Tasks due today", count: num(o.due_today_tasks), href: `/dashboard/tasks${qp("assignee")}`, tone: "amber" },
    { key: "open_leads", label: "Open leads", count: num(o.open_leads), amount: num(o.open_leads_amt), href: `/dashboard/leads${qp("owner")}`, tone: "violet" },
    { key: "open_meetings", label: "Upcoming meetings", count: num(o.open_meetings), href: `/dashboard/review-meetings${qp("rm")}`, tone: "sky" },
    { key: "open_srs", label: "Open service requests", count: num(o.open_srs), href: `/dashboard/service-requests${qp("assignee")}`, tone: "amber" },
    { key: "sip_rejections", label: "SIP rejections to fix", count: num(o.sip_rejections), href: "/dashboard/sip-rejections", tone: "rose" },
    { key: "insurance_renewals", label: "Insurance renewals (30d)", count: num(o.insurance_renewals), href: "/dashboard/insurance", tone: "amber" },
    { key: "activity_followups", label: "Activity follow-ups due", count: num(o.activity_followups), href: "/dashboard/activities", tone: "rose" },
    { key: "open_tasks", label: "All open tasks", count: num(o.open_tasks), href: `/dashboard/tasks${qp("assignee")}`, tone: "sky" },
  ];

  const periodic: Metric[] = [
    { key: "leads_added", label: "Leads added today", count: num(p.leads_added), amount: num(p.leads_added_amt), href: `/dashboard/leads${qp("owner")}`, tone: "violet" },
    { key: "tasks_completed", label: "Tasks completed today", count: num(p.tasks_completed), href: `/dashboard/tasks${qp("assignee")}`, tone: "emerald" },
    { key: "tasks_created", label: "Tasks created today", count: num(p.tasks_created), href: `/dashboard/tasks${qp("assignee")}`, tone: "sky" },
    { key: "meetings_today", label: "Meetings today", count: num(p.meetings_today), href: `/dashboard/review-meetings${qp("rm")}`, tone: "sky" },
    { key: "calls_today", label: "Calls logged today", count: num(p.calls_today), href: "/dashboard/activities?kind=call", tone: "sky" },
    { key: "visits_today", label: "Field visits today", count: num(p.visits_today), href: "/dashboard/activities?kind=visit", tone: "emerald" },
    { key: "clients_added", label: "New clients today", count: num(p.clients_added), href: `/dashboard/investors${qp("rm")}`, tone: "emerald" },
  ];

  const result: Metric[] = [
    { key: "converted_leads", label: "Leads converted", count: num(r.converted_leads), amount: num(r.converted_amt), href: `/dashboard/leads${qp("owner")}`, tone: "emerald" },
    { key: "lost_leads", label: "Leads lost", count: num(r.lost_leads), amount: num(r.lost_amt), href: `/dashboard/leads${qp("owner")}`, tone: "rose" },
    { key: "new_clients", label: "New clients", count: num(r.new_clients), amount: num(r.new_aum), href: `/dashboard/investors${qp("rm")}`, tone: "emerald" },
    { key: "completed_tasks", label: "Tasks completed", count: num(r.completed_tasks), href: `/dashboard/tasks${qp("assignee")}`, tone: "sky" },
    { key: "completed_meetings", label: "Meetings completed", count: num(r.completed_meetings), href: `/dashboard/review-meetings${qp("rm")}`, tone: "sky" },
  ];

  // ── PER-RM accountability roll-up ────────────────────────────────────
  const rms = (
    await tx.execute(sql`
      SELECT id, name FROM users
      WHERE status = 'active' AND ('rm' = ANY(roles) OR 'branch_head' = ANY(roles))
      ORDER BY name
    `)
  ).rows as Array<{ id: string; name: string }>;

  const map = new Map<string, RmRow>();
  for (const u of rms) {
    map.set(u.id, {
      id: u.id, name: u.name, overdueTasks: 0, dueTodayTasks: 0,
      openLeads: 0, openLeadsAmt: 0, completedTasks: 0, convertedLeads: 0, convertedAmt: 0,
    });
  }

  const taskAgg = (
    await tx.execute(sql`
      SELECT assignee_id,
        count(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at < now())::int AS overdue,
        count(*) FILTER (WHERE status IN ('open','in_progress','blocked') AND due_at::date = current_date)::int AS due_today,
        count(*) FILTER (WHERE status='completed' AND updated_at >= ${fromISO} AND updated_at < ${toEndISO})::int AS completed
      FROM tasks WHERE assignee_id IS NOT NULL
      GROUP BY assignee_id
    `)
  ).rows as any[];
  for (const t of taskAgg) {
    const row = map.get(t.assignee_id);
    if (row) { row.overdueTasks = num(t.overdue); row.dueTodayTasks = num(t.due_today); row.completedTasks = num(t.completed); }
  }

  const leadAgg = (
    await tx.execute(sql`
      SELECT owner_id,
        count(*) FILTER (WHERE converted_investor_id IS NULL AND ${OPEN_LEAD_STAGES})::int AS open_leads,
        COALESCE(SUM(NULLIF(regexp_replace(COALESCE(intended_amount,''),'[^0-9.]','','g'),'')::numeric)
          FILTER (WHERE converted_investor_id IS NULL AND ${OPEN_LEAD_STAGES}), 0) AS open_amt,
        count(*) FILTER (WHERE converted_at IS NOT NULL AND converted_at >= ${fromISO} AND converted_at < ${toEndISO})::int AS converted,
        COALESCE(SUM(NULLIF(regexp_replace(COALESCE(intended_amount,''),'[^0-9.]','','g'),'')::numeric)
          FILTER (WHERE converted_at IS NOT NULL AND converted_at >= ${fromISO} AND converted_at < ${toEndISO}), 0) AS converted_amt
      FROM leads WHERE owner_id IS NOT NULL
      GROUP BY owner_id
    `)
  ).rows as any[];
  for (const l of leadAgg) {
    const row = map.get(l.owner_id);
    if (row) {
      row.openLeads = num(l.open_leads);
      row.openLeadsAmt = num(l.open_amt);
      row.convertedLeads = num(l.converted);
      row.convertedAmt = num(l.converted_amt);
    }
  }

  // When scoped to a member, show just their row; otherwise list RMs who carry
  // any workload/result first and drop those with nothing.
  const perRm = [...map.values()]
    .filter((r) =>
      member
        ? r.id === member
        : r.overdueTasks || r.dueTodayTasks || r.openLeads || r.completedTasks || r.convertedLeads
    )
    .sort((a, b) => b.overdueTasks - a.overdueTasks || b.openLeadsAmt - a.openLeadsAmt);

  return { open, periodic, result, perRm, range: opts.rangeLabel };
}
