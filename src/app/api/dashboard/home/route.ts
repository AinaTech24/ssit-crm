import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/dashboard/home
 *
 * The native mobile Home screen's data. The web role dashboards (OwnerCockpit,
 * RmDashboard, …) render server-side with no JSON API, so this endpoint exposes
 * the same headline numbers as a compact, mobile-friendly payload: a few KPI
 * cards + a "Today" worklist of actionable counts that deep-link into filtered
 * lists.
 *
 * Scope mirrors the list endpoints: firm-wide for owner/back-office/ops/
 * compliance/branch-head; own-book (rm_id = me) for RMs. Each metric is computed
 * independently and fails soft to 0, so a schema difference never 500s Home.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FIRM_WIDE = ["owner", "back_office", "ops", "compliance", "branch_head"];

export async function GET() {
  try {
    const session = await requireSession();
    const roles = session.roles ?? [];
    const seesAll = roles.some((r) => FIRM_WIDE.includes(r));
    const mine = seesAll ? sql`` : sql` AND rm_id = ${session.userId}`;
    const mineOwner = seesAll ? sql`` : sql` AND owner_id = ${session.userId}`;

    const data = await withTenant(session.tenantId, async (tx) => {
      const one = async (query: any): Promise<number> => {
        try {
          const r = await tx.execute(query);
          return Number((r.rows[0] as any)?.v ?? 0);
        } catch {
          return 0;
        }
      };

      const [clients, aum, sipBook, leadsOpen, tasksOverdue, tasksToday, reviewsDue, followupsDue, meetingsToday] = await Promise.all([
        one(sql`SELECT count(*)::int AS v FROM investors WHERE status = 'active' AND deleted_at IS NULL${mine}`),
        one(sql`SELECT COALESCE(sum(aum),0)::float AS v FROM investors WHERE deleted_at IS NULL${mine}`),
        one(sql`SELECT COALESCE(sum(active_sip_amount),0)::float AS v FROM investors WHERE status = 'active' AND deleted_at IS NULL${mine}`),
        one(sql`SELECT count(*)::int AS v FROM leads WHERE converted_at IS NULL AND (stage IS NULL OR stage NOT IN ('lost','not_interested','not_qualified'))${mineOwner}`),
        one(sql`SELECT count(*)::int AS v FROM tasks WHERE status IN ('open','in_progress','blocked') AND deleted_at IS NULL AND due_at < now() AND (assignee_id = ${session.userId} OR ${seesAll})`),
        one(sql`SELECT count(*)::int AS v FROM tasks WHERE status IN ('open','in_progress','blocked') AND deleted_at IS NULL AND due_at >= date_trunc('day', now()) AND due_at < date_trunc('day', now()) + interval '1 day' AND (assignee_id = ${session.userId} OR ${seesAll})`),
        one(sql`SELECT count(*)::int AS v FROM investors WHERE status = 'active' AND deleted_at IS NULL AND next_review_at IS NOT NULL AND next_review_at <= now()${mine}`),
        one(sql`SELECT count(*)::int AS v FROM leads WHERE converted_at IS NULL AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()${mineOwner}`),
        one(sql`SELECT count(*)::int AS v FROM review_meetings WHERE status IN ('scheduled','confirmed') AND meeting_date >= date_trunc('day', now()) AND meeting_date < date_trunc('day', now()) + interval '1 day'${mine}`),
      ]);

      return { clients, aum, sipBook, leadsOpen, tasksOverdue, tasksToday, reviewsDue, followupsDue, meetingsToday };
    });

    return NextResponse.json({
      scope: seesAll ? "firm" : "me",
      kpis: [
        { key: "aum", label: "Total AUM", value: data.aum, format: "inr" },
        { key: "clients", label: "Active Clients", value: data.clients, format: "number" },
        { key: "sipBook", label: "Monthly SIP", value: data.sipBook, format: "inr" },
        { key: "leadsOpen", label: "Open Leads", value: data.leadsOpen, format: "number" },
      ],
      // "Today" — only actionable items; the app hides zero-count rows so Home
      // shows just what needs attention. All deep-link into kept modules.
      worklist: [
        { key: "tasksOverdue", label: "Overdue tasks", count: data.tasksOverdue, icon: "alert-triangle", tone: "danger", href: "/(app)/(tabs)/tasks" },
        { key: "tasksToday", label: "Tasks due today", count: data.tasksToday, icon: "check-square", tone: "warning", href: "/(app)/(tabs)/tasks" },
        { key: "followupsDue", label: "Follow-ups due", count: data.followupsDue, icon: "corner-up-right", tone: "warning", href: "/m/leads" },
        { key: "meetingsToday", label: "Meetings today", count: data.meetingsToday, icon: "video", tone: "info", href: "/m/review-meetings" },
        { key: "reviewsDue", label: "Client reviews due", count: data.reviewsDue, icon: "calendar", tone: "info", href: "/m/review-meetings" },
      ],
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
