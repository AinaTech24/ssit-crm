import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/calendar?month=YYYY-MM
 *
 * JSON calendar feed for the mobile app — reuses getCalendarItems() (the same
 * aggregation the web calendar page + ICS feed use) so tasks, meetings, reviews,
 * follow-ups, birthdays, renewals etc. match exactly. Scoped to the viewer's
 * book (managers see the whole firm).
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getCalendarItems } from "@/lib/calendar/items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const now = new Date();
    const month = req.nextUrl.searchParams.get("month") ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [yyyy, mm] = month.split("-").map(Number);
    if (!yyyy || !mm || mm < 1 || mm > 12) {
      return NextResponse.json({ error: "invalid month (use YYYY-MM)" }, { status: 400 });
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const lastDay = new Date(yyyy, mm, 0).getDate();
    const fromIso = `${yyyy}-${pad(mm)}-01`;
    const toIso = `${yyyy}-${pad(mm)}-${pad(lastDay)}`;

    const items = await withTenant(
      session.tenantId,
      async (tx) =>
        getCalendarItems(tx, {
          fromIso,
          toIso,
          scope: {
            userId: session.userId,
            tasksAll: can(session.roles, "task.view.all", session.permissions),
            leadsAll: can(session.roles, "lead.view.all", session.permissions),
            investorsAll: can(session.roles, "investor.view.all", session.permissions),
          },
        }),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const monthLabel = new Date(yyyy, mm - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    return NextResponse.json({ month, monthLabel, from: fromIso, to: toIso, items });
  } catch (err) {
    return handleApiError(err);
  }
}
