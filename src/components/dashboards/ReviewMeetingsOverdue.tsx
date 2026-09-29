/**
 * Clients whose review meeting has been due for 100+ days.
 *
 * A review date that has quietly slipped is invisible on a client record —
 * nobody opens 400 of them to notice. This lists the ones that have gone
 * unreviewed longest, firm-wide, and each row stays here until someone sets a
 * new review date on that client. Updating the date is the only thing that
 * clears it, which is the point: it is a worklist, not a notification that can
 * be dismissed and forgotten.
 *
 * Server component — reads under the caller's own data wall, so a branch head
 * seeing this sees their branch's clients and not the firm's.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarClock, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";

/** How overdue a review has to be before it lands on this list. */
export const REVIEW_OVERDUE_DAYS = 100;

type Row = {
  id: string;
  name: string;
  rm_name: string | null;
  next_review_at: string;
  days_overdue: number;
};

export async function ReviewMeetingsOverdue({
  session,
  limit = 12,
}: {
  session: SessionUser;
  limit?: number;
}) {
  let rows: Row[] = [];
  let total = 0;
  try {
    const data = await withTenant(session.tenantId, async (tx) => {
      const scope = await investorScopeSql(tx, session, "investors");
      const where = sql`
        investors.deleted_at IS NULL
        AND investors.status = 'active'
        AND investors.next_review_at IS NOT NULL
        AND investors.next_review_at <= now() - (${REVIEW_OVERDUE_DAYS} || ' days')::interval
        AND ${scope}
      `;
      const [listRes, countRes] = await Promise.all([
        tx.execute(sql`
          SELECT investors.id, investors.name, u.name AS rm_name,
                 investors.next_review_at,
                 EXTRACT(DAY FROM (now() - investors.next_review_at))::int AS days_overdue
          FROM investors
          LEFT JOIN users u ON u.id = investors.rm_id
          WHERE ${where}
          ORDER BY investors.next_review_at ASC
          LIMIT ${limit}
        `),
        tx.execute(sql`SELECT COUNT(*)::int AS n FROM investors WHERE ${where}`),
      ]);
      return {
        rows: listRes.rows as unknown as Row[],
        total: Number((countRes.rows[0] as { n?: number } | undefined)?.n ?? 0),
      };
    });
    rows = data.rows;
    total = data.total;
  } catch {
    // A dashboard panel must never take the whole page down.
    return null;
  }

  if (total === 0) return null;

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
            <CalendarClock className="size-3.5 text-rose-600" />
          </div>
          <div>
            <div className="font-medium text-sm">Review meetings overdue</div>
            <div className="text-[11px] text-muted-foreground">
              {REVIEW_OVERDUE_DAYS}+ days past due · stays here until the review date is updated
            </div>
          </div>
        </div>
        <span className="chip text-xs bg-rose-50 text-rose-700 font-semibold tabular-nums">{total}</span>
      </div>

      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/dashboard/investors/${r.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-accent/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">{r.rm_name ?? "No RM assigned"}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold tabular-nums text-rose-600">
                  {r.days_overdue}d
                </div>
                <div className="text-[11px] text-muted-foreground">overdue</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {total > rows.length && (
        <Link
          href="/dashboard/investors?reviews_due=1&sort=review&dir=asc"
          className="flex items-center justify-center gap-1 border-t px-4 py-2 text-xs font-medium text-brand-cyan hover:bg-accent/40"
        >
          See all {total} <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
