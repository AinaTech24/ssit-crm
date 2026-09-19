import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/dashboard/my-day?date=YYYY-MM-DD
 *
 * The field salesperson's daily driver: the ACTUAL actionable items for the day
 * (not just counts) + relationship touchpoints for the week. One round-trip:
 *   - meetings     : the day's scheduled/confirmed review meetings (+ client phone)
 *   - followups    : leads whose next follow-up falls on the day
 *   - tasks        : tasks due on the day
 *   - touchpoints  : client birthdays + investment anniversaries in the next 7 days
 *   - agenda       : per-day counts for the next 14 days — drives the Home week strip
 *
 * `date` defaults to today. When the day IS today, follow-ups and tasks also pull
 * in anything OVERDUE (flagged `overdue`) — what an RM owes doesn't disappear at
 * midnight. Future/past days are strictly day-scoped.
 *
 * Scope mirrors the other surfaces: firm-wide for managers, own-book for RMs.
 * Each block fails soft to [] so one schema difference never 500s the home screen.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const FIRM_WIDE = ["owner", "back_office", "ops", "compliance", "branch_head"];

/** Accept only YYYY-MM-DD; anything else falls back to today. */
const parseDate = (raw: string | null): string | null =>
  raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !isNaN(new Date(raw).getTime()) ? raw : null;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const roles = session.roles ?? [];
    const seesAll = roles.some((r) => FIRM_WIDE.includes(r)) || can(roles, "dashboard.view.owner", (session as any).permissions);
    const uid = session.userId;
    const dateParam = parseDate(req.nextUrl.searchParams.get("date"));

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const rows = async (q: any): Promise<any[]> => {
          try { return (await tx.execute(q)).rows as any[]; } catch { return []; }
        };
        // rm_id is legacy and NULL on anything booked recently (see
        // lib/auth/data-scope.ts) — matching it alone emptied My Day of every
        // meeting the user had booked or been assigned.
        const rmScope = seesAll
          ? sql``
          : sql` AND (m.rm_id = ${uid}::uuid OR m.created_by_id = ${uid}::uuid
                      OR jsonb_exists(COALESCE(m.collaborator_ids, '[]'::jsonb), ${uid}))`;
        const ownerScope = seesAll ? sql`` : sql` AND l.owner_id = ${uid}::uuid`;
        const invScope = (a: string) => seesAll ? sql`` : sql` AND ${sql.raw(a)}.rm_id = ${uid}::uuid`;

        // The selected day [dayStart, dayEnd) and whether it is today.
        const dayStart = dateParam ? sql`${dateParam}::date` : sql`date_trunc('day', now())::date`;
        const dayEnd = sql`(${dayStart} + interval '1 day')`;
        const isToday = sql`(${dayStart} = current_date)`;
        // On today, sweep in everything still owed; other days are day-scoped.
        const owedFrom = sql`(CASE WHEN ${isToday} THEN '-infinity'::timestamptz ELSE ${dayStart}::timestamptz END)`;

        const [meetings, followups, tasks, touchpoints, agenda] = await Promise.all([
          rows(sql`
            SELECT m.id, m.meeting_date AS at, m.subject, m.meeting_type, m.meeting_mode, m.status,
                   COALESCE(i.name, l.name) AS client_name,
                   COALESCE(i.phone, l.phone) AS phone,
                   m.investor_id, m.lead_id
            FROM review_meetings m
            LEFT JOIN investors i ON i.id = m.investor_id
            LEFT JOIN leads l ON l.id = m.lead_id
            WHERE m.tenant_id = ${session.tenantId}::uuid
              AND m.status IN ('scheduled','confirmed','in_progress')
              AND m.meeting_date >= ${dayStart}
              AND m.meeting_date < ${dayEnd}${rmScope}
            ORDER BY m.meeting_date ASC
            LIMIT 50
          `),
          rows(sql`
            SELECT l.id, l.name, l.phone, l.stage, l.next_follow_up_at,
                   (l.next_follow_up_at < current_date) AS overdue
            FROM leads l
            WHERE l.tenant_id = ${session.tenantId}::uuid
              AND l.converted_at IS NULL
              AND (l.stage IS NULL OR l.stage NOT IN ('lost','not_interested','not_qualified','converted','won','won_lead'))
              AND l.next_follow_up_at IS NOT NULL
              AND l.next_follow_up_at >= ${owedFrom}
              AND l.next_follow_up_at < ${dayEnd}${ownerScope}
            ORDER BY l.next_follow_up_at ASC
            LIMIT 50
          `),
          rows(sql`
            SELECT t.id, t.title, t.due_at, t.priority,
                   (t.due_at < current_date) AS overdue
            FROM tasks t
            WHERE t.tenant_id = ${session.tenantId}::uuid
              AND t.status IN ('open','in_progress','blocked')
              AND t.deleted_at IS NULL
              AND t.due_at >= ${owedFrom}
              AND t.due_at < ${dayEnd}
              AND (t.assignee_id = ${uid}::uuid OR ${seesAll})
            ORDER BY t.due_at ASC
            LIMIT 50
          `),
          rows(sql`
            SELECT id, name, phone, whatsapp_phone, at, kind, days_until, years FROM (
              SELECT i.id, i.name, i.phone, i.whatsapp_phone, i.dob AS at, 'birthday' AS kind,
                     mod(to_char(i.dob,'DDD')::int - to_char(current_date,'DDD')::int + 366, 366) AS days_until,
                     NULL::int AS years
              FROM investors i
              WHERE i.tenant_id = ${session.tenantId}::uuid AND i.status = 'active' AND i.deleted_at IS NULL
                AND i.dob IS NOT NULL
                AND mod(to_char(i.dob,'DDD')::int - to_char(current_date,'DDD')::int + 366, 366) <= 7${invScope("i")}
              UNION ALL
              SELECT i.id, i.name, i.phone, i.whatsapp_phone, i.onboarded_at::date AS at, 'anniversary' AS kind,
                     mod(to_char(i.onboarded_at,'DDD')::int - to_char(current_date,'DDD')::int + 366, 366) AS days_until,
                     EXTRACT(YEAR FROM age(i.onboarded_at))::int AS years
              FROM investors i
              WHERE i.tenant_id = ${session.tenantId}::uuid AND i.status = 'active' AND i.deleted_at IS NULL
                AND i.onboarded_at IS NOT NULL AND EXTRACT(YEAR FROM age(i.onboarded_at)) >= 1
                AND mod(to_char(i.onboarded_at,'DDD')::int - to_char(current_date,'DDD')::int + 366, 366) <= 7${invScope("i")}
            ) tp
            ORDER BY days_until ASC, name ASC
            LIMIT 40
          `),
          // Week strip: per-day counts for a 14-day window starting today. Today's
          // counts include what's overdue, so the strip agrees with the day's plan.
          rows(sql`
            SELECT to_char(d, 'YYYY-MM-DD') AS date,
              (SELECT count(*) FROM review_meetings m
                 WHERE m.tenant_id = ${session.tenantId}::uuid
                   AND m.status IN ('scheduled','confirmed','in_progress')
                   AND m.meeting_date >= d AND m.meeting_date < d + interval '1 day'${rmScope}
              )::int AS meetings,
              (SELECT count(*) FROM leads l
                 WHERE l.tenant_id = ${session.tenantId}::uuid
                   AND l.converted_at IS NULL
                   AND (l.stage IS NULL OR l.stage NOT IN ('lost','not_interested','not_qualified','converted','won','won_lead'))
                   AND l.next_follow_up_at >= (CASE WHEN d::date = current_date THEN '-infinity'::timestamptz ELSE d END)
                   AND l.next_follow_up_at < d + interval '1 day'${ownerScope}
              )::int AS followups,
              (SELECT count(*) FROM tasks t
                 WHERE t.tenant_id = ${session.tenantId}::uuid
                   AND t.status IN ('open','in_progress','blocked')
                   AND t.deleted_at IS NULL
                   AND t.due_at >= (CASE WHEN d::date = current_date THEN '-infinity'::timestamptz ELSE d END)
                   AND t.due_at < d + interval '1 day'
                   AND (t.assignee_id = ${uid}::uuid OR ${seesAll})
              )::int AS tasks
            FROM generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '13 days', interval '1 day') d
            ORDER BY d ASC
          `),
        ]);

        return { meetings, followups, tasks, touchpoints, agenda };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ scope: seesAll ? "firm" : "me", date: dateParam, ...data });
  } catch (err: any) {
    return handleApiError(err);
  }
}
