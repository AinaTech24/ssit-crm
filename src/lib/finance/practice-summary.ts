/**
 * Practice-finance summary — one server-side rollup that powers the Finances
 * hub overview, the P&L year-on-year comparison, and the monthly income/expense
 * trend. Keeping it in one place means the hub and the P&L can never disagree.
 *
 *   income   = amc_payouts (gross / TDS / net) for the FY
 *   expenses = business_expenses grouped by category for the FY
 *   monthly  = the 12 FY months (Apr→Mar), income vs expense, for the trend
 *   prev     = the same totals for the previous FY, for YoY deltas
 *   expected = projected annual trail on the current book (computeTrailForecast)
 *
 * `expected` lets the P&L flag the gap between commission actually *recorded*
 * (amc_payouts) and what the live AUM *should* be paying — i.e. import gaps or
 * AMC under-payment — instead of silently showing ₹0 when nothing is imported.
 */

import { sql } from "drizzle-orm";
import { fyStartYear, FY_MONTHS } from "./fiscal-year";
import { computeTrailForecast } from "./trail-forecast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type MonthPoint = { key: string; label: string; income: number; expense: number };
export type CategoryTotal = { category: string; total: number };

export type PracticeSummary = {
  fy: string;
  income: { gross: number; tds: number; net: number };
  expenses: { total: number; byCategory: CategoryTotal[] };
  netProfit: number;
  margin: number | null;
  monthly: MonthPoint[];
  topExpense: CategoryTotal | null;
  prev: { net: number; expenses: number; netProfit: number; margin: number | null };
  expectedAnnualIncome: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getPracticeSummary(tx: Tx, tenantId: string, fy: string): Promise<PracticeSummary> {
  const sy = fyStartYear(fy);
  const periodStart = `${sy}-04`;
  const periodEnd = `${sy + 1}-03`;
  const dateStart = `${sy}-04-01`;
  const dateEnd = `${sy + 1}-03-31`;
  const pPeriodStart = `${sy - 1}-04`;
  const pPeriodEnd = `${sy}-03`;
  const pDateStart = `${sy - 1}-04-01`;
  const pDateEnd = `${sy}-03-31`;

  const [income, prevIncome, expByCat, prevExpTotal, incByPeriod, expByMonth, trail] = await Promise.all([
    tx.execute(sql`
      SELECT COALESCE(SUM(gross_amount::numeric),0) AS gross,
             COALESCE(SUM(tds_amount::numeric),0)   AS tds,
             COALESCE(SUM(net_amount::numeric),0)   AS net
      FROM amc_payouts WHERE period >= ${periodStart} AND period <= ${periodEnd}
    `),
    tx.execute(sql`
      SELECT COALESCE(SUM(net_amount::numeric),0) AS net
      FROM amc_payouts WHERE period >= ${pPeriodStart} AND period <= ${pPeriodEnd}
    `),
    tx.execute(sql`
      SELECT category, COALESCE(SUM(amount::numeric),0) AS total
      FROM business_expenses WHERE expense_date >= ${dateStart}::date AND expense_date <= ${dateEnd}::date
      GROUP BY category ORDER BY total DESC
    `),
    tx.execute(sql`
      SELECT COALESCE(SUM(amount::numeric),0) AS total
      FROM business_expenses WHERE expense_date >= ${pDateStart}::date AND expense_date <= ${pDateEnd}::date
    `),
    tx.execute(sql`
      SELECT period, COALESCE(SUM(net_amount::numeric),0) AS net
      FROM amc_payouts WHERE period >= ${periodStart} AND period <= ${periodEnd}
      GROUP BY period
    `),
    tx.execute(sql`
      SELECT to_char(expense_date,'YYYY-MM') AS period, COALESCE(SUM(amount::numeric),0) AS total
      FROM business_expenses WHERE expense_date >= ${dateStart}::date AND expense_date <= ${dateEnd}::date
      GROUP BY 1
    `),
    computeTrailForecast(tx, tenantId).catch(() => null),
  ]);

  const inc = income.rows[0] as any;
  const gross = num(inc?.gross), tds = num(inc?.tds), net = num(inc?.net);

  const byCategory: CategoryTotal[] = (expByCat.rows as any[]).map((r) => ({ category: r.category, total: num(r.total) }));
  const totalExpenses = byCategory.reduce((s, r) => s + r.total, 0);
  const topExpense = byCategory[0] ?? null;

  const prevNet = num((prevIncome.rows[0] as any)?.net);
  const prevExp = num((prevExpTotal.rows[0] as any)?.total);
  const prevProfit = prevNet - prevExp;

  // Build the 12 FY months (Apr→Mar) and join income + expense by 'YYYY-MM'.
  const incMap = new Map<string, number>();
  for (const r of incByPeriod.rows as any[]) incMap.set(String(r.period), num(r.net));
  const expMap = new Map<string, number>();
  for (const r of expByMonth.rows as any[]) expMap.set(String(r.period), num(r.total));

  const monthly: MonthPoint[] = FY_MONTHS.map(({ key, label }) => {
    // FY_MONTHS.key is 0-indexed (0=Jan … 11=Dec). Apr-Dec (key 3-11) fall in the
    // FY start year; Jan-Mar (key 0-2) fall in the next calendar year.
    const cal = key + 1; // 1-12
    const year = key >= 3 ? sy : sy + 1;
    const ym = `${year}-${String(cal).padStart(2, "0")}`;
    return { key: ym, label, income: incMap.get(ym) ?? 0, expense: expMap.get(ym) ?? 0 };
  });

  const netProfit = net - totalExpenses;
  return {
    fy,
    income: { gross, tds, net },
    expenses: { total: totalExpenses, byCategory },
    netProfit,
    margin: net > 0 ? (netProfit / net) * 100 : null,
    monthly,
    topExpense,
    prev: { net: prevNet, expenses: prevExp, netProfit: prevProfit, margin: prevNet > 0 ? (prevProfit / prevNet) * 100 : null },
    expectedAnnualIncome: trail ? num((trail as any).projectedAnnual) : 0,
  };
}
