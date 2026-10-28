import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/reminders — what needs the current user's attention right now, for the
 * bottom-right pop-ups: tasks due or overdue, meetings starting soon, and
 * follow-ups that have come due. Always the caller's OWN items (assignee / owner
 * / participant), never a firm-wide list.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

type Rec = Record<string, any>;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const me = session.userId;
    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const [tasks, meetings, leadFollowUps, activityFollowUps, newTasks, newMeetings, newFollowUps] = await Promise.all([
          tx.execute(sql`
            SELECT id, title, due_at FROM tasks
             WHERE tenant_id = ${session.tenantId}::uuid AND assignee_id = ${me}::uuid
               AND status IN ('open', 'in_progress', 'blocked')
               AND due_at IS NOT NULL AND due_at <= now() + interval '2 hours'
             ORDER BY due_at ASC LIMIT 8`),
          tx.execute(sql`
            SELECT m.id, m.subject, m.meeting_date, COALESCE(i.name, l.name) AS party
              FROM review_meetings m
              LEFT JOIN investors i ON i.id = m.investor_id
              LEFT JOIN leads l ON l.id = m.lead_id
             WHERE m.tenant_id = ${session.tenantId}::uuid
               AND m.status IN ('scheduled', 'confirmed', 'rescheduled')
               AND m.meeting_date >= now() - interval '15 minutes'
               AND m.meeting_date <= now() + interval '1 hour'
               AND (m.created_by_id = ${me}::uuid OR m.rm_id = ${me}::uuid
                    OR jsonb_exists(COALESCE(m.collaborator_ids, '[]'::jsonb), ${me}))
             ORDER BY m.meeting_date ASC LIMIT 8`),
          tx.execute(sql`
            SELECT id, name, next_follow_up_at FROM leads
             WHERE tenant_id = ${session.tenantId}::uuid AND owner_id = ${me}::uuid
               AND deleted_at IS NULL AND converted_investor_id IS NULL
               AND lost_reason IS DISTINCT FROM '__deleted__'
               AND stage NOT IN ('lost', 'not_interested', 'converted')
               AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= now() + interval '1 hour'
             ORDER BY next_follow_up_at ASC LIMIT 8`),
          tx.execute(sql`
            SELECT id, subject_type, subject_id, subject_name, next_followup_at FROM activities
             WHERE tenant_id = ${session.tenantId}::uuid AND owner_user_id = ${me}::uuid
               AND next_followup_at IS NOT NULL AND next_followup_at <= now() + interval '1 hour'
               AND next_followup_at >= now() - interval '7 days'
             ORDER BY next_followup_at ASC LIMIT 8`),
          // Just created (last 10 minutes) — so a new task, meeting or follow-up
          // pops up straight away with its title, not only when it falls due.
          tx.execute(sql`
            SELECT id, title, due_at FROM tasks
             WHERE tenant_id = ${session.tenantId}::uuid AND assignee_id = ${me}::uuid
               AND status IN ('open', 'in_progress', 'blocked')
               AND created_at >= now() - interval '10 minutes'
             ORDER BY created_at DESC LIMIT 8`),
          tx.execute(sql`
            SELECT m.id, m.subject, m.meeting_date, COALESCE(i.name, l.name) AS party
              FROM review_meetings m
              LEFT JOIN investors i ON i.id = m.investor_id
              LEFT JOIN leads l ON l.id = m.lead_id
             WHERE m.tenant_id = ${session.tenantId}::uuid
               AND m.created_at >= now() - interval '10 minutes'
               AND (m.created_by_id = ${me}::uuid OR m.rm_id = ${me}::uuid
                    OR jsonb_exists(COALESCE(m.collaborator_ids, '[]'::jsonb), ${me}))
             ORDER BY m.created_at DESC LIMIT 8`),
          tx.execute(sql`
            SELECT id, subject_type, subject_id, subject_name, next_followup_at FROM activities
             WHERE tenant_id = ${session.tenantId}::uuid AND owner_user_id = ${me}::uuid
               AND next_followup_at IS NOT NULL
               AND created_at >= now() - interval '10 minutes'
             ORDER BY created_at DESC LIMIT 8`),
        ]);
        const followHref = (r: Rec) =>
          r.subject_type === "investor"
            ? `/dashboard/investors/${r.subject_id}`
            : r.subject_type === "lead"
              ? `/dashboard/leads/${r.subject_id}`
              : "/dashboard/activities";
        return {
          tasks: tasks.rows,
          meetings: meetings.rows,
          newTasks: newTasks.rows,
          newMeetings: newMeetings.rows,
          newFollowUps: (newFollowUps.rows as Rec[]).map((r) => ({
            id: `act-${r.id}`,
            title: r.subject_name ?? "Follow-up",
            at: r.next_followup_at,
            href: followHref(r),
          })),
          followUps: [
            ...(leadFollowUps.rows as Rec[]).map((r) => ({
              id: `lead-${r.id}`,
              title: r.name,
              at: r.next_follow_up_at,
              href: `/dashboard/leads/${r.id}`,
            })),
            ...(activityFollowUps.rows as Rec[]).map((r) => ({
              id: `act-${r.id}`,
              title: r.subject_name ?? "Follow-up",
              at: r.next_followup_at,
              href:
                r.subject_type === "investor"
                  ? `/dashboard/investors/${r.subject_id}`
                  : r.subject_type === "lead"
                    ? `/dashboard/leads/${r.subject_id}`
                    : "/dashboard/activities",
            })),
          ],
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
