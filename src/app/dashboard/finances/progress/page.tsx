/**
 * Monthly Progress (Network FP 8.5) — firm annual targets vs computed actuals.
 *
 * Actuals are derived live: new clients (investors.onboarded_at), leads
 * (leads.created_at), meetings done (review_meetings completed), AUM addition
 * (net successful transactions), SIP book addition (new sips), lumpsum added
 * (successful purchase/lumpsum inflows). Targets come from business_targets.
 *
 * Gated by reports.commission. FY via ?fy=YYYY-YY.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { businessTargets } from "@/db/schema";
import { currentFyLabel, fyStartYear, recentFyLabels } from "@/lib/finance/fiscal-year";
import { MonthlyProgressTable, type MetricRow, type MetricKey } from "@/components/finances/MonthlyProgressTable";

export const dynamic = "force-dynamic";

const METRICS: Array<{ key: MetricKey; label: string; kind: "count" | "currency" }> = [
  { key: "new_clients", label: "New clients added", kind: "count" },
  { key: "leads_generated", label: "Leads / referrals generated", kind: "count" },
  { key: "meetings_done", label: "Meetings done", kind: "count" },
  { key: "aum_addition", label: "Total AUM addition (net)", kind: "currency" },
  { key: "sip_book_addition", label: "New SIP book addition", kind: "currency" },
  { key: "lumpsum_added", label: "Fresh lumpsum added", kind: "currency" },
];

/** Turn rows of {m: <calendar month 1-12>, v} into a {0..11 → value} map + total. */
function bucket(rows: any[]): { byMonth: Record<number, number>; total: number } {
  const byMonth: Record<number, number> = {};
  let total = 0;
  for (const r of rows) {
    const month0 = Number(r.m) - 1; // SQL EXTRACT(MONTH) is 1-12 → 0-11
    const v = Number(r.v);
    byMonth[month0] = (byMonth[month0] ?? 0) + v;
    total += v;
  }
  return { byMonth, total };
}

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "finances.view", session.permissions);
  const sp = await searchParams;
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : currentFyLabel();
  const sy = fyStartYear(fy);
  const dateStart = `${sy}-04-01`;
  const dateEnd = `${sy + 1}-03-31`;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [clients, leadsR, meetings, aum, sipBook, lumpsum, targets] = await Promise.all([
        tx.execute(sql`
          SELECT EXTRACT(MONTH FROM onboarded_at)::int AS m, COUNT(*)::numeric AS v
          FROM investors
          WHERE onboarded_at >= ${dateStart}::date AND onboarded_at <= ${dateEnd}::date
          GROUP BY 1`),
        tx.execute(sql`
          SELECT EXTRACT(MONTH FROM created_at)::int AS m, COUNT(*)::numeric AS v
          FROM leads
          WHERE created_at >= ${dateStart}::date AND created_at <= ${dateEnd}::date
          GROUP BY 1`),
        tx.execute(sql`
          SELECT EXTRACT(MONTH FROM meeting_date)::int AS m, COUNT(*)::numeric AS v
          FROM review_meetings
          WHERE status = 'completed' AND meeting_date >= ${dateStart}::date AND meeting_date <= ${dateEnd}::date
          GROUP BY 1`),
        tx.execute(sql`
          SELECT EXTRACT(MONTH FROM order_date)::int AS m,
            COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END), 0) AS v
          FROM transactions
          WHERE status IN ('successful','processed') AND order_date >= ${dateStart}::date AND order_date <= ${dateEnd}::date
          GROUP BY 1`),
        tx.execute(sql`
          SELECT EXTRACT(MONTH FROM created_at)::int AS m, COALESCE(SUM(amount::numeric), 0) AS v
          FROM sips
          WHERE created_at >= ${dateStart}::date AND created_at <= ${dateEnd}::date
          GROUP BY 1`),
        tx.execute(sql`
          SELECT EXTRACT(MONTH FROM order_date)::int AS m, COALESCE(SUM(amount::numeric), 0) AS v
          FROM transactions
          WHERE status IN ('successful','processed') AND direction = 'inflow'
            AND type IN ('lumpsum','purchase')
            AND order_date >= ${dateStart}::date AND order_date <= ${dateEnd}::date
          GROUP BY 1`),
        tx
          .select()
          .from(businessTargets)
          .where(and(eq(businessTargets.tenantId, session.tenantId), eq(businessTargets.fiscalYear, fy))),
      ]);
      return {
        new_clients: bucket(clients.rows as any[]),
        leads_generated: bucket(leadsR.rows as any[]),
        meetings_done: bucket(meetings.rows as any[]),
        aum_addition: bucket(aum.rows as any[]),
        sip_book_addition: bucket(sipBook.rows as any[]),
        lumpsum_added: bucket(lumpsum.rows as any[]),
        targets: targets as any[],
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const targetByMetric: Record<string, number> = {};
  for (const t of data.targets) targetByMetric[t.metric] = Number(t.annualTarget);

  const rows: MetricRow[] = METRICS.map((m) => {
    const b = (data as any)[m.key] as { byMonth: Record<number, number>; total: number };
    return {
      metric: m.key,
      label: m.label,
      kind: m.kind,
      total: b.total,
      byMonth: b.byMonth,
      target: targetByMetric[m.key] ?? 0,
    };
  });

  const fyOptions = recentFyLabels(4);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/dashboard/finances" className="hover:underline inline-flex items-center gap-1">
              <ChevronLeft className="size-3" /> Finances
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Monthly progress</h1>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
          {fyOptions.map((y) => (
            <Link
              key={y}
              href={`/dashboard/finances/progress?fy=${y}`}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${y === fy ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
            >
              FY {y}
            </Link>
          ))}
        </div>
      </div>

      <MonthlyProgressTable fy={fy} rows={rows} />
    </div>
  );
}
