/**
 * Targets vs Achievement — month-to-date achievement aggregates per RM.
 *
 * Three metrics, matching what the Targets settings page + dashboard quota show:
 *   - business         → net mobilisation MTD (inflow − outflow) on the RM's book
 *   - new_meetings      → # review_meetings this month with category = 'new'
 *   - renewal_meetings  → # review_meetings this month with category = 'review'
 *
 * Computed for the whole tenant in three small grouped queries; the caller maps
 * the per-RM aggregates onto the member list it already loaded. Runs inside an
 * existing withTenant() transaction so RLS scopes it to the tenant.
 */

import { sql } from "drizzle-orm";

export type MonthAchievements = {
  businessByRm: Record<string, number>;
  newMeetingsByRm: Record<string, number>;
  renewalMeetingsByRm: Record<string, number>;
};

/** First day of the current month + first day of next month, as ISO yyyy-mm-dd. */
export function currentMonthBounds(now = new Date()): { startISO: string; endISO: string; label: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return { startISO: iso(start), endISO: iso(end), label };
}

export async function getMonthAchievements(
  tx: any,
  tenantId: string,
  startISO: string,
  endISO: string
): Promise<MonthAchievements> {
  // Net business MTD per RM (inflow − outflow), only settled transactions.
  const biz = (await tx.execute(sql`
    SELECT i.rm_id AS rm,
      (COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.direction = 'inflow'), 0)
       - COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.direction = 'outflow'), 0))::numeric AS net
    FROM transactions t
    JOIN investors i ON i.id = t.investor_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.status IN ('processed', 'successful')
      AND t.order_date >= ${startISO}::date
      AND t.order_date < ${endISO}::date
      AND i.rm_id IS NOT NULL
      AND i.deleted_at IS NULL
    GROUP BY i.rm_id
  `)).rows as Array<{ rm: string; net: string }>;

  // Meeting counts this month per RM + category (exclude cancelled).
  const mtg = (await tx.execute(sql`
    SELECT rm_id AS rm, category, COUNT(*)::int AS n
    FROM review_meetings
    WHERE tenant_id = ${tenantId}::uuid
      AND meeting_date >= ${startISO}::date
      AND meeting_date < ${endISO}::date
      AND status <> 'cancelled'
      AND rm_id IS NOT NULL
    GROUP BY rm_id, category
  `)).rows as Array<{ rm: string; category: string; n: number }>;

  const businessByRm: Record<string, number> = {};
  for (const r of biz) businessByRm[r.rm] = Number(r.net) || 0;

  const newMeetingsByRm: Record<string, number> = {};
  const renewalMeetingsByRm: Record<string, number> = {};
  for (const r of mtg) {
    if (r.category === "new") newMeetingsByRm[r.rm] = (newMeetingsByRm[r.rm] ?? 0) + Number(r.n);
    else if (r.category === "review") renewalMeetingsByRm[r.rm] = (renewalMeetingsByRm[r.rm] ?? 0) + Number(r.n);
  }

  return { businessByRm, newMeetingsByRm, renewalMeetingsByRm };
}
