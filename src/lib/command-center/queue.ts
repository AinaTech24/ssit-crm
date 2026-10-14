/**
 * Command Center — the unified, prioritised "what needs me today" worklist.
 *
 * This is the human-facing complement to the automation engine: the
 * daily-ops scanner emits *events* that drive recipes; this reads the
 * *current state* across modules and ranks the open actions a person should
 * work through, newest-pain-first.
 *
 * Scope:
 *   · firm-wide (owner / branch head / compliance) → the whole tenant
 *   · personal (RM / ops)                          → only rows they own
 * Tenant isolation is RLS (withTenant); the personal scope is an extra
 * `<owner column> = :userId` predicate layered on top.
 *
 * Each group is one indexed COUNT-with-preview query (top 5 rows +
 * `count(*) over()` total), so the whole board is ~10 light queries.
 */

import { sql } from "drizzle-orm";

export type Severity = "now" | "today" | "soon";

export type ActionItem = {
  id: string;
  title: string;
  detail?: string;
  href: string;
  /** The item's relevant date (yyyy-mm-dd) for date-range filtering. Null/absent
   *  = an always-current item (e.g. an SLA breach) that a date range never hides. */
  date?: string | null;
  /** ₹ at stake (SIP amount, AUM, proposal/mandate value) — drives prioritisation. */
  amount?: number | null;
  /** Days the item has been waiting/overdue (computed in the post-process pass). */
  ageDays?: number;
  /** The client this item is about — powers the "by client" consolidated view. */
  client?: { id: string; name: string } | null;
  /** Phone for one-tap WhatsApp actions (birthdays/anniversaries). */
  phone?: string | null;
  /** Drives the inline quick-action set: task | birthday | anniversary | generic. */
  actionType?: "task" | "birthday" | "anniversary" | "generic";
  /** Stable per-user snooze key ("<group>:<id>") — set in the post-process pass. */
  itemKey?: string;
  /** When true, this single item is severe enough to escalate its group to "now". */
  escalate?: boolean;
};

/** Coerce a timestamp/date value to a yyyy-mm-dd string (or null). */
function ymd(v: any): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export type ActionGroup = {
  key: string;
  label: string;
  /** lucide icon name — resolved in the client component */
  icon: string;
  severity: Severity;
  /** tone for the count badge */
  tone: "rose" | "amber" | "sky" | "violet" | "emerald";
  count: number;
  /** "view all" link (filtered module route) */
  href: string;
  /** up to 5 preview rows */
  items: ActionItem[];
};

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

/**
 * Build the personal-scope predicate for a given column, or empty for
 * firm-wide. The column is a hardcoded constant from the call sites below
 * (never user input) so sql.raw is safe; the userId is bound as a parameter.
 */
function scope(col: string, owners: string | string[], firmWide: boolean) {
  if (firmWide) return sql``;
  if (Array.isArray(owners)) {
    // A set of people (a sub-branch, or a head's own team). An empty set is
    // "nobody", never "everybody".
    if (owners.length === 0) return sql` AND FALSE`;
    return sql` AND ${sql.raw(col)} IN (${sql.join(owners.map((o) => sql`${o}::uuid`), sql`, `)})`;
  }
  return sql` AND ${sql.raw(col)} = ${owners}`;
}

/** Append mine=1 to a personal-scoped deep link so the module lands pre-filtered. */
function href(base: string, firmWide: boolean, extra = "") {
  const parts = [extra, firmWide ? "" : "mine=1"].filter(Boolean);
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

export async function buildCommandQueue(
  tx: Tx,
  opts: {
    userId: string;
    firmWide: boolean;
    clientId?: string;
    /**
     * Scope the queue to this SET of people instead of one user or the whole
     * firm — a sub-branch head's team, or one sub-branch picked from the
     * dropdown. Takes precedence over firmWide (callers pass firmWide: false).
     */
    userIds?: string[] | null;
  }
): Promise<ActionGroup[]> {
  const { userId, firmWide, clientId } = opts;
  const owners: string | string[] = opts.userIds ?? userId;
  const ownerList: string[] | null = Array.isArray(owners) ? owners : null;
  const groups: ActionGroup[] = [];

  // Per-user snooze/dismiss set — items the user deferred or dismissed are
  // excluded from their view (dismissed forever; snoozed until the window ends).
  const snoozed = new Set<string>();
  try {
    const sn = await tx.execute(sql`
      SELECT item_key FROM command_center_snoozes
      WHERE user_id = ${userId}::uuid
        AND (dismissed = true OR (snoozed_until IS NOT NULL AND snoozed_until > now()))
    `);
    for (const row of sn.rows) snoozed.add(String((row as any).item_key));
  } catch {
    /* table missing (pre-migration) — treat as no snoozes */
  }

  // When the board is scoped to a single client, every investor-centric group
  // gets an extra `<investor column> = :clientId` predicate. The column name is
  // a hardcoded constant from the call sites (never user input) so sql.raw is
  // safe; the id is bound as a parameter. Groups that aren't about a client
  // (leave approvals, your own clock-in, lead follow-ups) are skipped entirely.
  const cscope = (col: string) => (clientId ? sql` AND ${sql.raw(col)} = ${clientId}` : sql``);

  // ── 1. Service-request SLA breaches (firefight) ──────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, ticket_no, subject, sla_resolution_at, count(*) OVER() AS total
      FROM service_requests
      WHERE status IN ('open','in_progress','waiting_customer','escalated')
        AND sla_resolution_at IS NOT NULL
        AND sla_resolution_at < now()
        ${scope("assigned_to_user_id", owners, firmWide)}${cscope("investor_id")}
      ORDER BY sla_resolution_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "sla_breach",
        label: "SLA breached — service requests",
        icon: "LifeBuoy",
        severity: "now",
        tone: "rose",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/service-requests",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.subject ?? `Ticket #${x.ticket_no}`,
          detail: `#${x.ticket_no} · SLA passed`,
          href: `/dashboard/service-requests/${x.id}`,
          date: ymd(x.sla_resolution_at),
        })),
      });
    }
  }

  // ── 2. SIP bounces (mandate / balance trouble → churn) ───────────────
  {
    const r = await tx.execute(sql`
      SELECT s.id, s.scheme_name, s.amount, COALESCE(s.consecutive_failures,'0') AS fails,
             i.id AS investor_id, i.name AS investor_name, count(*) OVER() AS total
      FROM sips s
      JOIN investors i ON i.id = s.investor_id
      WHERE (s.status = 'rejected' OR COALESCE(NULLIF(s.consecutive_failures,''),'0')::int > 0)
        AND s.status <> 'stopped'
        ${scope("s.rm_id", owners, firmWide)}${cscope("s.investor_id")}
      ORDER BY COALESCE(NULLIF(s.consecutive_failures,''),'0')::int DESC, s.amount DESC NULLS LAST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "sip_bounce",
        label: "SIP bounces to rescue",
        icon: "XOctagon",
        severity: "now",
        tone: "rose",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/sip-rejections",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.investor_name,
          detail: [`${x.scheme_name ?? "SIP"}`, inr(x.amount), `${x.fails} bounce${Number(x.fails) === 1 ? "" : "es"}`].filter(Boolean).join(" · "),
          href: `/dashboard/sip-rejections`,
          amount: Number(x.amount ?? 0) || null,
          client: { id: x.investor_id, name: x.investor_name },
        })),
      });
    }
  }

  // ── 3. Redemption-risk clients (retention) ───────────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, redemption_risk_reason, aum, count(*) OVER() AS total
      FROM investors
      WHERE (status = 'redemption_risk' OR redemption_risk_flagged_at IS NOT NULL)
        AND deleted_at IS NULL
        ${scope("rm_id", owners, firmWide)}${cscope("id")}
      ORDER BY aum DESC NULLS LAST, redemption_risk_flagged_at DESC NULLS LAST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "redemption_risk",
        label: "Redemption-risk clients",
        icon: "TrendingDown",
        severity: "now",
        tone: "rose",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/reports/churn-risk",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: [inr(x.aum) ? `${inr(x.aum)} AUM` : null, x.redemption_risk_reason ?? "Flagged at-risk"].filter(Boolean).join(" · "),
          href: `/dashboard/investors/${x.id}`,
          amount: Number(x.aum ?? 0) || null,
          client: { id: x.id, name: x.name },
        })),
      });
    }
  }

  // ── 4. Reviews overdue (service promise) ─────────────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, service_tier, next_review_at, aum, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND next_review_at IS NOT NULL
        AND next_review_at < now()
        ${scope("rm_id", owners, firmWide)}${cscope("id")}
      ORDER BY aum DESC NULLS LAST, next_review_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "reviews_due",
        label: "Reviews overdue",
        icon: "CalendarClock",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide || ownerList !== null, "reviews_due=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: [`Tier ${x.service_tier ?? "—"}`, inr(x.aum) ? `${inr(x.aum)} AUM` : null, `due ${fmt(x.next_review_at)}`].filter(Boolean).join(" · "),
          href: `/dashboard/investors/${x.id}`,
          date: ymd(x.next_review_at),
          amount: Number(x.aum ?? 0) || null,
          client: { id: x.id, name: x.name },
        })),
      });
    }
  }

  // ── 4b. Meetings today (be prepared, be on time) ─────────────────────
  {
    const r = await tx.execute(sql`
      SELECT m.id, m.meeting_type, m.subject, m.meeting_date,
             COALESCE(i.name, l.name) AS party_name, count(*) OVER() AS total
      FROM review_meetings m
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l ON l.id = m.lead_id
      WHERE m.status IN ('scheduled','confirmed')
        AND m.meeting_date::date = current_date
        ${scope("m.rm_id", owners, firmWide)}${cscope("m.investor_id")}
      ORDER BY m.meeting_date ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "meetings_today",
        label: "Meetings today",
        icon: "Calendar",
        severity: "today",
        tone: "sky",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/review-meetings",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.party_name ?? "Client",
          detail: `${x.subject ? x.subject : String(x.meeting_type).replace(/_/g, " ")} · ${new Date(x.meeting_date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`,
          href: `/dashboard/review-meetings/${x.id}`,
          date: ymd(x.meeting_date),
        })),
      });
    }
  }

  // ── 4c. Leave requests to approve (managers only) ────────────────────
  if ((firmWide || (ownerList && ownerList.length > 1)) && !clientId) {
    const r = await tx.execute(sql`
      SELECT la.id, la.leave_type, la.from_date, la.to_date, la.no_of_days,
             u.name AS employee_name, count(*) OVER() AS total
      FROM leave_applications la
      LEFT JOIN users u ON u.id = la.employee_user_id
      WHERE la.status = 'requested'
        ${ownerList ? scope("la.employee_user_id", ownerList, false) : sql``}
      ORDER BY la.created_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "leave_approvals",
        label: "Leave requests to approve",
        icon: "CalendarOff",
        severity: "today",
        tone: "violet",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/leave-applications?status=requested",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.employee_name ?? "Employee",
          detail: `${x.no_of_days} day(s) · ${String(x.leave_type).replace(/_/g, " ")} · ${fmt(x.from_date)}`,
          href: "/dashboard/leave-applications?status=requested",
          date: ymd(x.from_date),
        })),
      });
    }
  }

  // ── 4d. Clock in (personal) — if you haven't punched today on a workday ──
  if (!clientId) {
    const r = await tx.execute(sql`
      SELECT
        EXISTS(
          SELECT 1 FROM attendance
          WHERE employee_user_id = ${userId}::uuid AND attendance_date = current_date
            AND (clock_in_at IS NOT NULL OR status IN ('week_off','holiday','on_leave'))
        ) AS handled,
        (EXTRACT(DOW FROM current_date) = 0) AS is_sunday
    `);
    const row = r.rows[0] as any;
    if (row && !row.handled && !row.is_sunday) {
      groups.push({
        key: "clock_in",
        label: "Clock in for today",
        icon: "CalendarCheck",
        severity: "today",
        tone: "sky",
        count: 1,
        href: "/dashboard/attendance",
        items: [{ id: "clock", title: "You haven't clocked in yet", detail: "Mark your attendance for today", href: "/dashboard/attendance" }],
      });
    }
  }

  // ── 5. KYC / CKYC expiring or broken (blocks transactions) ───────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, kyc_status, ckyc_expiry_at, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND (
          kyc_status IN ('expired','re_kyc_required','rejected')
          OR (ckyc_expiry_at IS NOT NULL
              AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
        )
        ${scope("rm_id", owners, firmWide)}${cscope("id")}
      ORDER BY ckyc_expiry_at ASC NULLS FIRST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "kyc_expiring",
        label: "KYC expiring / broken",
        icon: "ShieldAlert",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide || ownerList !== null, "kyc_expiring=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: x.ckyc_expiry_at ? `CKYC expires ${fmt(x.ckyc_expiry_at)}` : `KYC ${x.kyc_status}`,
          href: `/dashboard/investors/${x.id}`,
          date: ymd(x.ckyc_expiry_at),
          client: { id: x.id, name: x.name },
          // Already-broken KYC (not just expiring soon) escalates to "act now".
          escalate: ["expired", "re_kyc_required", "rejected"].includes(x.kyc_status),
        })),
      });
    }
  }

  // ── 6. Overdue tasks ─────────────────────────────────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, title, priority, due_at, subject_type, subject_id,
             related_investor_id, related_lead_id, related_meeting_id, related_service_request_id,
             count(*) OVER() AS total
      FROM tasks
      WHERE status IN ('open','in_progress')
        AND deleted_at IS NULL
        AND due_at IS NOT NULL
        AND due_at < now()
        ${scope("assignee_id", owners, firmWide)}${cscope("related_investor_id")}
      ORDER BY due_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      // Link each task to the RECORD it's about (client / lead / meeting / service
      // request) so clicking opens that record — not the generic tasks list.
      // Prefer the explicit related-entity columns, then the legacy subject, and
      // only fall back to the tasks list for a task with no linked entity.
      const taskHref = (x: any): string => {
        if (x.related_investor_id) return `/dashboard/investors/${x.related_investor_id}`;
        if (x.related_lead_id) return `/dashboard/leads/${x.related_lead_id}`;
        if (x.related_meeting_id) return `/dashboard/review-meetings/${x.related_meeting_id}`;
        if (x.related_service_request_id) return `/dashboard/service-requests/${x.related_service_request_id}`;
        if (x.subject_id) {
          if (x.subject_type === "investor") return `/dashboard/investors/${x.subject_id}`;
          if (x.subject_type === "lead") return `/dashboard/leads/${x.subject_id}`;
          if (x.subject_type === "family") return `/dashboard/families/${x.subject_id}`;
          if (x.subject_type === "service_request") return `/dashboard/service-requests/${x.subject_id}`;
        }
        return "/dashboard/tasks";
      };
      groups.push({
        key: "tasks_overdue",
        label: "Overdue tasks",
        icon: "ListChecks",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/tasks",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.title,
          detail: `${x.priority} · due ${fmt(x.due_at)}`,
          href: taskHref(x),
          date: ymd(x.due_at),
          actionType: "task" as const,
        })),
      });
    }
  }

  // ── 7. Overdue lead follow-ups (pipeline leaking) ────────────────────
  if (!clientId) {
    const r = await tx.execute(sql`
      SELECT id, name, stage, next_follow_up_at, count(*) OVER() AS total
      FROM leads
      WHERE converted_investor_id IS NULL
        AND stage NOT IN ('not_qualified','lost','not_interested','converted')
        AND next_follow_up_at IS NOT NULL
        AND next_follow_up_at < now()
        ${scope("owner_id", owners, firmWide)}
      ORDER BY next_follow_up_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "lead_followups",
        label: "Lead follow-ups overdue",
        icon: "Sparkles",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/leads", firmWide || ownerList !== null),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: `${String(x.stage).replace(/_/g, " ")} · due ${fmt(x.next_follow_up_at)}`,
          href: `/dashboard/leads/${x.id}`,
          date: ymd(x.next_follow_up_at),
        })),
      });
    }
  }

  // ── 8. (Risk-profile refresh queue removed — Risk Profile is retired.) ──

  // ── 9. Birthdays TODAY (wish them — a do-it-today touchpoint) ────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, dob, phone, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND dob IS NOT NULL
        AND to_char(dob, 'MM-DD') = to_char(current_date, 'MM-DD')
        ${scope("rm_id", owners, firmWide)}${cscope("id")}
      ORDER BY name ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "birthdays_today",
        label: "Birthdays today 🎂",
        icon: "Cake",
        severity: "today",
        tone: "violet",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide || ownerList !== null, "birthday_today=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: turnsToday(x.dob),
          href: `/dashboard/investors/${x.id}`,
          phone: x.phone ?? null,
          actionType: "birthday" as const,
          client: { id: x.id, name: x.name },
        })),
      });
    }
  }

  // ── 10. Birthdays in the next 7 days (heads-up; excludes today) ──────
  {
    const r = await tx.execute(sql`
      SELECT id, name, dob, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND dob IS NOT NULL
        AND to_char(dob, 'MM-DD') BETWEEN to_char(current_date + interval '1 day', 'MM-DD')
                                      AND to_char(current_date + interval '7 days', 'MM-DD')
        ${scope("rm_id", owners, firmWide)}${cscope("id")}
      ORDER BY to_char(dob, 'MM-DD') ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "birthdays",
        label: "Birthdays this week",
        icon: "Cake",
        severity: "soon",
        tone: "violet",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide || ownerList !== null, "birthday_week=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: `Birthday ${fmt(x.dob, true)}`,
          href: `/dashboard/investors/${x.id}`,
        })),
      });
    }
  }

  // ── 11. Mandates rejected by the bank (first SIP blocked → re-register) ──
  {
    const r = await tx.execute(sql`
      SELECT id, name, count(*) OVER() AS total
      FROM investors
      WHERE mandate_status = 'rejected'
        AND deleted_at IS NULL
        ${scope("rm_id", owners, firmWide)}${cscope("id")}
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "mandate_rejected",
        label: "Mandates rejected — re-register",
        icon: "XOctagon",
        severity: "now",
        tone: "rose",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide || ownerList !== null, "mandate_rejected=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: "Bank rejected the NACH / e-mandate",
          href: `/dashboard/investors/${x.id}`,
          client: { id: x.id, name: x.name },
        })),
      });
    }
  }

  // ── 12. Onboarding stalled — docs requested but not received in 3+ days ──
  if (!clientId) {
    const r = await tx.execute(sql`
      SELECT id, name, stage, stage_changed_at, count(*) OVER() AS total
      FROM leads
      WHERE converted_investor_id IS NULL
        AND stage IN ('request_documents','documents_pending','docs_requested')
        AND stage_changed_at IS NOT NULL
        AND stage_changed_at < now() - interval '3 days'
        ${scope("owner_id", owners, firmWide)}
      ORDER BY stage_changed_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "onboarding_stuck",
        label: "Onboarding stalled — docs pending",
        icon: "CalendarClock",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/leads", firmWide || ownerList !== null),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: `Waiting since ${fmt(x.stage_changed_at)}`,
          href: `/dashboard/leads/${x.id}`,
          date: ymd(x.stage_changed_at),
        })),
      });
    }
  }

  // ── 13. Proposals sent & aging (awaiting client approval 7+ days) ───────
  {
    const propScope = firmWide
      ? sql``
      : ownerList
        ? ownerList.length === 0
          ? sql` AND FALSE`
          : sql` AND (investor_id IN (SELECT id FROM investors WHERE rm_id IN (${sql.join(ownerList.map((o) => sql`${o}::uuid`), sql`, `)}))
                  OR lead_id IN (SELECT id FROM leads WHERE owner_id IN (${sql.join(ownerList.map((o) => sql`${o}::uuid`), sql`, `)})))`
        : sql` AND (investor_id IN (SELECT id FROM investors WHERE rm_id = ${userId})
                  OR lead_id IN (SELECT id FROM leads WHERE owner_id = ${userId}))`;
    const r = await tx.execute(sql`
      SELECT id, recipient_name, title, sent_at, count(*) OVER() AS total
      FROM proposals
      WHERE sent_at IS NOT NULL AND accepted_at IS NULL AND rejected_at IS NULL
        AND sent_at < now() - interval '7 days'
        ${propScope}${cscope("investor_id")}
      ORDER BY sent_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "proposals_aging",
        label: "Proposals awaiting approval",
        icon: "FileText",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/proposals",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.recipient_name ?? x.title,
          detail: `${x.title ?? "Proposal"} · sent ${fmt(x.sent_at)}`,
          href: `/dashboard/proposals`,
          date: ymd(x.sent_at),
        })),
      });
    }
  }

  // ── 14. Unanswered inbound messages (client replied, no response) ───────
  {
    const inScope = firmWide
      ? sql``
      : ownerList
        ? ownerList.length === 0
          ? sql` AND FALSE`
          : sql` AND (i.rm_id IN (${sql.join(ownerList.map((o) => sql`${o}::uuid`), sql`, `)}) OR l.owner_id IN (${sql.join(ownerList.map((o) => sql`${o}::uuid`), sql`, `)}))`
        : sql` AND (i.rm_id = ${userId} OR l.owner_id = ${userId})`;
    const r = await tx.execute(sql`
      SELECT c.id, c.channel, c.created_at,
             COALESCE(i.id, l.id) AS party_id,
             COALESCE(i.name, l.name) AS party_name,
             (c.investor_id IS NOT NULL) AS is_investor,
             count(*) OVER() AS total
      FROM communications c
      LEFT JOIN investors i ON i.id = c.investor_id
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.direction = 'inbound'
        AND c.created_at > now() - interval '14 days'
        AND (c.investor_id IS NOT NULL OR c.lead_id IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM communications o
          WHERE o.tenant_id = c.tenant_id AND o.direction = 'outbound'
            AND o.created_at > c.created_at
            AND (o.investor_id IS NOT DISTINCT FROM c.investor_id
                 AND o.lead_id IS NOT DISTINCT FROM c.lead_id)
        )
        ${inScope}${cscope("c.investor_id")}
      ORDER BY c.created_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "unanswered_inbound",
        label: "Unanswered messages",
        icon: "MessageCircle",
        severity: "today",
        tone: "sky",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/communications",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.party_name ?? "Client",
          detail: `Replied on ${x.channel} · ${fmt(x.created_at)} — no response yet`,
          href: x.is_investor ? `/dashboard/investors/${x.party_id}` : `/dashboard/leads/${x.party_id}`,
          date: ymd(x.created_at),
          client: x.is_investor && x.party_id ? { id: x.party_id, name: x.party_name } : null,
        })),
      });
    }
  }

  // ── 15. Anniversaries today (relationship touchpoint) ───────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, phone, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND anniversary_date IS NOT NULL
        AND to_char(anniversary_date, 'MM-DD') = to_char(current_date, 'MM-DD')
        ${scope("rm_id", owners, firmWide)}${cscope("id")}
      ORDER BY name ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "anniversaries_today",
        label: "Anniversaries today 💐",
        icon: "Cake",
        severity: "today",
        tone: "violet",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide || ownerList !== null),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: "Wedding anniversary today",
          href: `/dashboard/investors/${x.id}`,
          phone: x.phone ?? null,
          actionType: "anniversary" as const,
          client: { id: x.id, name: x.name },
        })),
      });
    }
  }

  // ── Post-process: snooze filtering, aging, ₹-weighting, dynamic severity ──
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const ageOf = (d?: string | null) => {
    if (!d) return undefined;
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt.getTime())) return undefined;
    return Math.max(0, Math.round((today0.getTime() - dt.getTime()) / 86_400_000));
  };
  // Per-group: how many days overdue escalates the WHOLE group to "act now".
  const escalateAfterDays: Record<string, number> = {
    reviews_due: 45,
    tasks_overdue: 7,
    lead_followups: 14,
    onboarding_stuck: 10,
  };
  const processed: ActionGroup[] = [];
  for (const g of groups) {
    let removed = 0;
    const items = g.items
      .map((it) => ({ ...it, itemKey: `${g.key}:${it.id}`, ageDays: it.ageDays ?? ageOf(it.date) }))
      .filter((it) => {
        if (snoozed.has(it.itemKey!)) {
          removed++;
          return false;
        }
        return true;
      });
    if (items.length === 0 && removed >= g.count) continue; // wholly snoozed away
    const count = Math.max(g.count - removed, items.length);
    let severity = g.severity;
    const thr = escalateAfterDays[g.key];
    if (thr != null && items.some((it) => (it.ageDays ?? 0) > thr)) severity = "now";
    if (items.some((it) => it.escalate)) severity = "now";
    processed.push({ ...g, items, count, severity });
  }

  // Severity band → ₹ at stake → biggest pile.
  const order: Record<Severity, number> = { now: 0, today: 1, soon: 2 };
  const groupAmount = (g: ActionGroup) => g.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  processed.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      groupAmount(b) - groupAmount(a) ||
      b.count - a.count
  );
  return processed;
}

/** "Turns 42 today" from a date of birth (falls back gracefully). */
function turnsToday(dob: any): string {
  const d = dob instanceof Date ? dob : new Date(dob);
  if (isNaN(d.getTime())) return "Birthday today";
  const age = new Date().getFullYear() - d.getFullYear();
  return age > 0 && age < 130 ? `Turns ${age} today` : "Birthday today";
}

/** Compact INR — ₹50K / ₹1.2L / ₹3.4Cr. */
function inr(n: any): string | null {
  const v = Number(n);
  if (!v || isNaN(v)) return null;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  if (v >= 1e3) return `₹${Math.round(v / 1e3)}K`;
  return `₹${Math.round(v)}`;
}

function fmt(v: any, dayMonth = false): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", dayMonth
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "short", year: "2-digit" });
}
