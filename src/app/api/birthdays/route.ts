import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/birthdays — client birthdays for Today and Tomorrow. Powers the
 * header birthday widget (cake icon).
 *
 * There used to be a third bucket, Past (the last 30 days). The widget dropped
 * that tab — a wish you already missed is not work anyone can do — so the
 * query no longer walks a 30-day window on every poll either. The whole month
 * is one click away on the client list (?birthday_month=1).
 *
 * Year-agnostic match on MM-DD, computed entirely in SQL against current_date
 * (consistent with the other birthday surfaces). Firm-wide for owners/branch
 * heads/compliance; own-book only for everyone else.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

type Item = { id: string; name: string; dob: string; turning: number | null };

function turning(dob: string): number | null {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const age = new Date().getFullYear() - d.getFullYear();
  return age > 0 && age < 130 ? age : null;
}

export async function GET() {
  try {
    const session = await requireSession();
    const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`
          WITH w AS (
            SELECT to_char(current_date, 'MM-DD') AS today_md,
                   to_char(current_date + 1, 'MM-DD') AS tom_md
          )
          SELECT i.id, i.name, i.dob,
            CASE WHEN to_char(i.dob, 'MM-DD') = w.today_md THEN 'today' ELSE 'tomorrow' END AS bucket
          FROM investors i, w
          WHERE i.status <> 'closed'
            AND i.merged_into_id IS NULL
            AND i.deleted_at IS NULL
            AND i.dob IS NOT NULL
            AND to_char(i.dob, 'MM-DD') IN (w.today_md, w.tom_md)
            ${firmWide ? sql`` : sql` AND i.rm_id = ${session.userId}`}
          ORDER BY i.name
        `);
        return r.rows as Array<{ id: string; name: string; dob: string; bucket: string }>;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const today: Item[] = [];
    const tomorrow: Item[] = [];
    for (const row of rows) {
      const item: Item = { id: row.id, name: row.name, dob: row.dob, turning: turning(row.dob) };
      (row.bucket === "today" ? today : tomorrow).push(item);
    }

    return NextResponse.json({
      today,
      tomorrow,
      counts: { today: today.length, tomorrow: tomorrow.length },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
