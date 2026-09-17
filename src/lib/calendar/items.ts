/**
 * Calendar aggregation — the single source of truth for "what's on the
 * calendar" across tasks, lead follow-ups, client reviews, SIP debits,
 * campaigns and compliance expiries.
 *
 * Both the in-app calendar page and the ICS subscription feed call this so the
 * two can never drift (they previously duplicated six near-identical queries
 * with different windows + filters). SERVER-ONLY (runs inside a withTenant tx).
 *
 * Scoping: non-managers only see their OWN book — own tasks (assignee/creator),
 * own leads (owner), own clients (rm). RLS isolates by tenant; this layer adds
 * the per-user slice the rest of the app enforces. Managers (the relevant
 * *.view.all capability) see the whole firm.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type CalendarKind = "task" | "follow_up" | "meeting" | "review" | "sip" | "campaign" | "compliance";

export type CalendarItem = {
  /** Stable id (source row id, namespaced) — drives a deterministic ICS UID. */
  id: string;
  kind: CalendarKind;
  /** YYYY-MM-DD (for the month grid + all-day ICS events). */
  date: string;
  /** ISO datetime when the event has a real clock time; null = all-day. */
  at: string | null;
  title: string;
  meta?: string;
  href: string;
  description?: string;
  subjectType?: "investor" | "lead";
  subjectId?: string;
  avatarUrl?: string | null;
  personName?: string;
};

export type CalendarScope = {
  userId: string;
  /** can(roles, "task.view.all") */
  tasksAll: boolean;
  /** can(roles, "lead.view.all") */
  leadsAll: boolean;
  /** can(roles, "investor.view.all") — also gates compliance (NISM/KYC). */
  investorsAll: boolean;
  /**
   * Colleagues whose diary this user runs (users.delegates_for, migration
   * 0220). Widens MEETINGS only — an EA who books for a partner gets that
   * partner's meetings on their own calendar, not their clients or tasks.
   */
  delegatedUserIds?: string[];
};

/** Normalise a pg date/timestamp value to YYYY-MM-DD. */
const ymd = (v: any): string =>
  typeof v === "string" ? v.slice(0, 10) : v ? new Date(v).toISOString().slice(0, 10) : "";

/** Normalise to an ISO datetime string, or null. */
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);

export async function getCalendarItems(
  tx: Tx,
  opts: { fromIso: string; toIso: string; scope: CalendarScope }
): Promise<CalendarItem[]> {
  const { fromIso, toIso, scope } = opts;

  // Per-source ownership predicates (empty for managers).
  const taskScope = scope.tasksAll
    ? sql``
    : sql` AND (assignee_id = ${scope.userId}::uuid OR created_by_id = ${scope.userId}::uuid)`;
  const leadScope = scope.leadsAll ? sql`` : sql` AND owner_id = ${scope.userId}::uuid`;
  const invScope = scope.investorsAll ? sql`` : sql` AND rm_id = ${scope.userId}::uuid`;
  // rm_id is DEPRECATED on review_meetings — created_by_id superseded it, and
  // 0203 added collaborator_ids. Matching rm_id alone meant every meeting booked
  // since that change (rm_id NULL) was filtered out of the calendar for anyone
  // without firm-wide client access: the meeting existed, the calendar was empty.
  const delegated = (scope.delegatedUserIds ?? []).filter((u) => u && u !== scope.userId);
  const delegatedMeetingSql = delegated.length
    ? sql` OR rm.rm_id IN (${sql.join(delegated.map((u) => sql`${u}::uuid`), sql`, `)})
        OR rm.created_by_id IN (${sql.join(delegated.map((u) => sql`${u}::uuid`), sql`, `)})`
    : sql``;
  const meetingScope = scope.investorsAll
    ? sql``
    : sql` AND (
        rm.created_by_id = ${scope.userId}::uuid
        OR rm.rm_id = ${scope.userId}::uuid
        OR jsonb_exists(COALESCE(rm.collaborator_ids, '[]'::jsonb), ${scope.userId})
        OR i.rm_id = ${scope.userId}::uuid
        OR l.owner_id = ${scope.userId}::uuid${delegatedMeetingSql}
      )`;
  const sipScope = scope.investorsAll ? sql`` : sql` AND i.rm_id = ${scope.userId}::uuid`;
  const nismScope = scope.investorsAll ? sql`` : sql` AND id = ${scope.userId}::uuid`;
  const kycScope = scope.investorsAll ? sql`` : sql` AND rm_id = ${scope.userId}::uuid`;

  const [tasks, leads, meetings, reviews, sips, campaigns, compliance] = await Promise.all([
    tx.execute(sql`
      SELECT id, title, description, due_at, due_at::date AS d, priority
      FROM tasks
      WHERE due_at IS NOT NULL
        AND deleted_at IS NULL
        AND due_at::date >= ${fromIso} AND due_at::date <= ${toIso}
        AND status NOT IN ('completed', 'cancelled')${taskScope}
      ORDER BY due_at ASC LIMIT 500
    `),
    tx.execute(sql`
      SELECT id, name, avatar_url, next_follow_up_at::date AS d, stage
      FROM leads
      WHERE next_follow_up_at IS NOT NULL
        AND next_follow_up_at::date >= ${fromIso} AND next_follow_up_at::date <= ${toIso}
        AND converted_investor_id IS NULL AND stage NOT IN ('lost')${leadScope}
      LIMIT 500
    `),
    // Actually-scheduled meetings (from the Meetings module / review_meetings
    // table) — previously missing from the calendar entirely. The "review"
    // block below is a DIFFERENT thing: investors.next_review_at is an
    // auto-computed "due for review" date, not a real scheduled appointment.
    tx.execute(sql`
      SELECT rm.id, rm.meeting_type, rm.subject, rm.meeting_date,
             rm.meeting_date::date AS d, rm.status, rm.meeting_mode,
             rm.investor_id, rm.lead_id,
             COALESCE(i.name, l.name) AS person_name,
             COALESCE(i.avatar_url, l.avatar_url) AS avatar_url
      FROM review_meetings rm
      LEFT JOIN investors i ON i.id = rm.investor_id
      LEFT JOIN leads l ON l.id = rm.lead_id
      WHERE rm.meeting_date::date >= ${fromIso} AND rm.meeting_date::date <= ${toIso}
        AND rm.status <> 'cancelled'${meetingScope}
      ORDER BY rm.meeting_date ASC LIMIT 500
    `),
    tx.execute(sql`
      SELECT id, name, avatar_url, next_review_at::date AS d, segment_tag
      FROM investors
      WHERE next_review_at IS NOT NULL
        AND deleted_at IS NULL
        AND next_review_at::date >= ${fromIso} AND next_review_at::date <= ${toIso}${invScope}
      LIMIT 500
    `),
    tx.execute(sql`
      SELECT s.id, s.scheme_name, s.amount, s.next_installment_at::date AS d,
             i.id AS investor_id, i.name AS investor_name, i.avatar_url AS investor_avatar_url
      FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
      WHERE s.status = 'active' AND s.next_installment_at IS NOT NULL
        AND i.deleted_at IS NULL
        AND s.next_installment_at::date >= ${fromIso} AND s.next_installment_at::date <= ${toIso}${sipScope}
      LIMIT 500
    `),
    tx.execute(sql`
      SELECT id, name, scheduled_at, scheduled_at::date AS d, channel, status
      FROM campaigns
      WHERE scheduled_at IS NOT NULL
        AND scheduled_at::date >= ${fromIso} AND scheduled_at::date <= ${toIso}
      LIMIT 200
    `),
    tx.execute(sql`
      SELECT 'arn' AS ckind, t.id::text AS id, t.arn AS who, t.arn_expiry_at AS d
      FROM tenants t WHERE t.arn_expiry_at IS NOT NULL
        AND t.arn_expiry_at >= ${fromIso}::date AND t.arn_expiry_at <= ${toIso}::date
      UNION ALL
      SELECT 'nism', id::text, name, nism_expiry_at::date
      FROM users WHERE nism_expiry_at IS NOT NULL
        AND nism_expiry_at::date >= ${fromIso} AND nism_expiry_at::date <= ${toIso}${nismScope}
      UNION ALL
      SELECT 'kyc', id::text, name, ckyc_expiry_at
      FROM investors WHERE ckyc_expiry_at IS NOT NULL
        AND deleted_at IS NULL
        AND ckyc_expiry_at >= ${fromIso}::date AND ckyc_expiry_at <= ${toIso}::date${kycScope}
      LIMIT 200
    `),
  ]);

  const out: CalendarItem[] = [];

  for (const r of tasks.rows as any[]) {
    out.push({
      id: `task-${r.id}`, kind: "task", date: ymd(r.d), at: iso(r.due_at),
      title: r.title, meta: r.priority, href: "/dashboard/tasks",
      description: r.description ?? undefined,
    });
  }
  for (const r of leads.rows as any[]) {
    out.push({
      id: `follow_up-${r.id}`, kind: "follow_up", date: ymd(r.d), at: null,
      title: `Follow up: ${r.name}`, meta: r.stage, href: `/dashboard/leads/${r.id}`,
      description: `Stage: ${r.stage}`,
      subjectType: "lead", subjectId: r.id, avatarUrl: r.avatar_url ?? null, personName: r.name,
    });
  }
  for (const r of meetings.rows as any[]) {
    const subjectType: "investor" | "lead" | undefined = r.investor_id
      ? "investor"
      : r.lead_id
        ? "lead"
        : undefined;
    const subjectId = r.investor_id ?? r.lead_id ?? undefined;
    const typeLabel = String(r.meeting_type ?? "").replace(/_/g, " ");
    out.push({
      id: `meeting-${r.id}`,
      kind: "meeting",
      date: ymd(r.d),
      at: iso(r.meeting_date),
      title: r.subject || `${typeLabel} · ${r.person_name ?? "—"}`.trim(),
      meta: `${r.status}${r.meeting_mode ? ` · ${r.meeting_mode}` : ""}`,
      href: subjectType === "investor" ? `/dashboard/investors/${subjectId}` : `/dashboard/review-meetings/${r.id}`,
      description: `${typeLabel} with ${r.person_name ?? "—"} · ${r.status}`,
      subjectType,
      subjectId,
      avatarUrl: r.avatar_url ?? null,
      personName: r.person_name ?? undefined,
    });
  }
  for (const r of reviews.rows as any[]) {
    out.push({
      id: `review-${r.id}`, kind: "review", date: ymd(r.d), at: null,
      title: `Review: ${r.name}`, meta: r.segment_tag ?? "", href: `/dashboard/investors/${r.id}`,
      description: `Segment: ${r.segment_tag ?? "—"}`,
      subjectType: "investor", subjectId: r.id, avatarUrl: r.avatar_url ?? null, personName: r.name,
    });
  }
  for (const r of sips.rows as any[]) {
    out.push({
      id: `sip-${r.id}`, kind: "sip", date: ymd(r.d), at: null,
      title: `SIP · ${r.investor_name ?? "—"}`, meta: `₹${r.amount} · ${r.scheme_name ?? ""}`,
      href: "/dashboard/sips", description: `Amount: ₹${r.amount}\nScheme: ${r.scheme_name ?? "—"}`,
      subjectType: "investor", subjectId: r.investor_id ?? undefined,
      avatarUrl: r.investor_avatar_url ?? null, personName: r.investor_name ?? undefined,
    });
  }
  for (const r of campaigns.rows as any[]) {
    out.push({
      id: `campaign-${r.id}`, kind: "campaign", date: ymd(r.d), at: iso(r.scheduled_at),
      title: r.name, meta: `${r.channel} · ${r.status}`, href: `/dashboard/campaigns/${r.id}`,
      description: `Channel: ${r.channel} · Status: ${r.status}`,
    });
  }
  for (const r of compliance.rows as any[]) {
    out.push({
      id: `compliance-${r.ckind}-${r.id}`, kind: "compliance", date: ymd(r.d), at: null,
      title: `${String(r.ckind).toUpperCase()} expiry: ${r.who}`, href: "/dashboard/compliance",
      description: `Compliance renewal alert for ${r.who}`,
    });
  }

  return out;
}
