import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET   /api/notifications?unreadOnly=1   — list for the current user
 * POST  /api/notifications/mark-read       — mark some/all as read
 *
 * Notifications are user-scoped (not just tenant-scoped). RLS allows
 * users to read only their own rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { notifications } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "1";

    // Owners/branch-heads/compliance see firm-wide birthdays; everyone else
    // sees only their own book (rm_id = them).
    const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);

    const rows = await withTenant(session.tenantId, async (tx) => {
      // archivedAt filter matters: the unreadCount query below already excludes
      // archived rows, so without it here a dismissed notification still shows
      // in the panel while the badge ignores it — the list and the count
      // disagree, which reads as "notifications are broken".
      const conditions = [
        eq(notifications.userId, session.userId),
        isNull(notifications.archivedAt),
      ];
      if (unreadOnly) conditions.push(isNull(notifications.readAt));
      const list = await tx
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
      const unreadCount = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM notifications
        WHERE user_id = ${session.userId} AND read_at IS NULL AND archived_at IS NULL
      `);
      // Today's birthdays — a live reminder, computed each load (no rows
      // written). Scoped to the caller's book unless they're firm-wide.
      const bday = await tx.execute(sql`
        SELECT name FROM investors
        WHERE status = 'active'
          AND deleted_at IS NULL
          AND dob IS NOT NULL
          AND to_char(dob, 'MM-DD') = to_char(current_date, 'MM-DD')
          ${firmWide ? sql`` : sql` AND rm_id = ${session.userId}`}
        ORDER BY name
        LIMIT 25
      `);
      return {
        list,
        unreadCount: Number((unreadCount.rows[0] as any)?.c ?? 0),
        birthdayNames: (bday.rows as Array<{ name: string }>).map((r) => r.name),
      };
    });

    // Prepend a single live "birthdays today" reminder when there are any.
    // It is NOT added to unreadCount (the badge stays accurate for real,
    // dismissable notifications) — it's a pinned daily relationship nudge.
    const list: any[] = [...rows.list];
    if (rows.birthdayNames.length > 0) {
      const n = rows.birthdayNames.length;
      const shown = rows.birthdayNames.slice(0, 3).join(", ");
      const more = n > 3 ? ` +${n - 3} more` : "";
      list.unshift({
        id: "birthday-today",
        kind: "birthday_today",
        title: `🎂 ${n} client birthday${n === 1 ? "" : "s"} today`,
        body: shown + more,
        linkUrl: "/dashboard/investors?birthday_today=1",
        severity: "info",
        readAt: null,
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ notifications: list, unreadCount: rows.unreadCount });
  } catch (err: any) {
    return handleApiError(err);
  }
}
