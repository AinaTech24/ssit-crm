/**
 * Firm P&L Statement (Network FP 8.3).
 *
 * Income = AMC commission payouts (amc_payouts) for the fiscal year.
 * Expenses = business_expenses grouped by category.
 * Net profit = net commission received − total expenses.
 *
 * Gated by reports.commission. FY via ?fy=YYYY-YY.
 */

import Link from "next/link";
import { ChevronLeft, ArrowUpRight, ArrowDownRight, AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { PrintReportButton } from "@/components/investors/PrintReportButton";
import { currentFyLabel, recentFyLabels } from "@/lib/finance/fiscal-year";
import { getPracticeSummary } from "@/lib/finance/practice-summary";
import { MonthlyTrendChart } from "@/components/finances/MonthlyTrendChart";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<string, string> = {
  office_rent: "Office Rent",
  team_salaries: "Team Salaries",
  team_welfare: "Team Welfare",
  utilities: "Utilities / Internet",
  travel: "Travel / Meetings",
  tech: "Tech / Software",
  knowledge: "Knowledge / Training",
  marketing: "Marketing",
  gst: "GST Paid",
  others: "Others",
};

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "finances.view", session.permissions);
  const sp = await searchParams;
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : currentFyLabel();

  const s = await withTenant(
    session.tenantId,
    (tx) => getPracticeSummary(tx, session.tenantId, fy),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const data = { exp: s.expenses.byCategory.map((c) => ({ category: c.category, total: c.total })) };
  const grossIncome = s.income.gross;
  const tds = s.income.tds;
  const netIncome = s.income.net;
  const totalExpenses = s.expenses.total;

  // YoY deltas (this FY vs last FY) — % change, null when last FY is zero.
  const pct2 = (cur: number, prev: number) => (prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null);
  const incomeDelta = pct2(netIncome, s.prev.net);
  const expenseDelta = pct2(totalExpenses, s.prev.expenses);
  const profitDelta = pct2(s.netProfit, s.prev.netProfit);

  // Recorded vs expected: projected annual trail on the live book. A large gap
  // means commission isn't fully imported or an AMC is under-paying.
  const expected = s.expectedAnnualIncome;
  const incomeGap = expected > 0 ? expected - grossIncome : 0;
  const showGap = expected > 0 && incomeGap > expected * 0.1; // flag only a >10% shortfall
  const netProfit = netIncome - totalExpenses;
  const margin = netIncome > 0 ? (netProfit / netIncome) * 100 : null;
  const pct = (n: number) => (netIncome > 0 ? `${((n / netIncome) * 100).toFixed(1)}%` : "—");

  const fyOptions = recentFyLabels(4);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/dashboard/finances" className="hover:underline inline-flex items-center gap-1">
              <ChevronLeft className="size-3" /> Finances
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">P&amp;L statement</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
            {fyOptions.map((y) => (
              <Link
                key={y}
                href={`/dashboard/finances/pnl?fy=${y}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${y === fy ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                FY {y}
              </Link>
            ))}
          </div>
          <PrintReportButton />
        </div>
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">P&amp;L Statement — FY {fy}</h1>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Net income" value={formatINR(netIncome)} tone="emerald" delta={incomeDelta} />
        <Card label="Total expenses" value={formatINR(totalExpenses)} tone="rose" delta={expenseDelta} invertDelta />
        <Card label="Net profit" value={formatINR(netProfit)} tone={netProfit >= 0 ? "emerald" : "rose"} delta={profitDelta} />
        <Card label="Net margin" value={margin != null ? `${margin.toFixed(1)}%` : "—"} tone="cyan" />
      </div>

      {/* Year-on-year comparison */}
      {(s.prev.net > 0 || s.prev.expenses > 0) && (
        <div className="card-surface overflow-hidden print:hidden">
          <div className="border-b px-4 py-2.5 font-semibold text-sm">This year vs last year</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Metric</th>
                <th className="text-right py-2 font-medium">FY {prevFyLabel(fy)}</th>
                <th className="text-right py-2 font-medium">FY {fy}</th>
                <th className="text-right py-2 font-medium pr-4">Change</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Net income" prev={s.prev.net} cur={netIncome} />
              <CompareRow label="Total expenses" prev={s.prev.expenses} cur={totalExpenses} invert />
              <CompareRow label="Net profit" prev={s.prev.netProfit} cur={netProfit} bold />
            </tbody>
          </table>
        </div>
      )}

      {/* Monthly income vs expense trend */}
      <div className="print:hidden">
        <MonthlyTrendChart data={s.monthly.map((m) => ({ label: m.label, income: m.income, expense: m.expense }))} />
      </div>

      {/* Income */}
      <div className="card-surface overflow-hidden">
        <div className="border-b px-4 py-2.5 font-semibold text-sm">Income</div>
        <table className="w-full text-sm">
          <tbody>
            <Row label="Mutual fund distribution (gross commission)" value={grossIncome} pct={pct(grossIncome)} />
            <Row label="Less: TDS deducted" value={-tds} pct={pct(tds)} muted />
            <Row label="Net commission received" value={netIncome} bold />
          </tbody>
        </table>
        {grossIncome === 0 && (
          <div className="px-4 py-2 text-[11px] text-muted-foreground border-t">
            No commission payouts recorded for FY {fy}. Import a CAMS/KFin statement under{" "}
            <Link href="/dashboard/commission-reconciliation" className="text-brand-cyan-deep hover:underline">
              Commission Reconciliation
            </Link>
            .
          </div>
        )}
        {showGap && (
          <div className="px-4 py-2.5 border-t bg-amber-50/60 text-[11px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            <span>
              Your live book should generate about <strong>{formatINR(Math.round(expected))}</strong> of annual
              trail, but only <strong>{formatINR(Math.round(grossIncome))}</strong> is recorded for FY {fy} — a{" "}
              <strong>{formatINR(Math.round(incomeGap))}</strong> gap. Either commission statements aren&apos;t
              fully imported, or an AMC is under-paying. Reconcile under{" "}
              <Link href="/dashboard/commission-reconciliation" className="underline">Commission Reconciliation</Link>.
            </span>
          </div>
        )}
      </div>

      {/* Expenses */}
      <div className="card-surface overflow-hidden">
        <div className="border-b px-4 py-2.5 font-semibold text-sm flex items-center justify-between">
          <span>Expenses</span>
          <Link href={`/dashboard/finances/expenses?fy=${fy}`} className="text-xs text-brand-cyan-deep hover:underline font-medium print:hidden">
            Edit ledger →
          </Link>
        </div>
        {data.exp.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No expenses recorded for FY {fy}.
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data.exp.map((r) => (
                <Row key={r.category} label={CAT_LABEL[r.category] ?? r.category} value={Number(r.total)} pct={pct(Number(r.total))} />
              ))}
              <Row label="Total expenditure" value={totalExpenses} bold />
            </tbody>
          </table>
        )}
      </div>

      {/* Net profit band */}
      <div className={`rounded-lg border p-4 flex items-center justify-between ${netProfit >= 0 ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"
        }`}>
        <span className="font-semibold text-sm">Net profit (FY {fy})</span>
        <span className={`text-xl font-bold tabular-nums ${netProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {formatINR(netProfit)}{margin != null ? ` · ${margin.toFixed(1)}% margin` : ""}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  pct,
  bold,
  muted,
}: {
  label: string;
  value: number;
  pct?: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <tr className={`border-b last:border-0 ${bold ? "bg-secondary/30" : ""}`}>
      <td className={`px-4 py-2.5 ${bold ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}>{label}</td>
      <td className={`py-2.5 text-right tabular-nums pr-4 ${bold ? "font-bold" : ""}`}>{formatINR(value)}</td>
      <td className="py-2.5 text-right tabular-nums text-xs text-muted-foreground pr-4 w-16">{pct ?? ""}</td>
    </tr>
  );
}

function Card({
  label,
  value,
  tone,
  delta,
  invertDelta,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "cyan";
  delta?: number | null;
  invertDelta?: boolean; // for expenses, a rise is "bad" (rose), a fall is "good"
}) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-brand-cyan-deep";
  const good = delta != null && (invertDelta ? delta <= 0 : delta >= 0);
  return (
    <div className="card-surface glass-card p-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${cls}`}>{value}</div>
      {delta != null && (
        <div className={`text-[11px] mt-0.5 inline-flex items-center gap-0.5 ${good ? "text-emerald-600" : "text-rose-600"}`}>
          {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {Math.abs(delta).toFixed(0)}% vs last FY
        </div>
      )}
    </div>
  );
}

/** Previous FY label, e.g. "2025-26" → "2024-25". */
function prevFyLabel(fy: string): string {
  const start = parseInt(fy.slice(0, 4), 10) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function CompareRow({ label, prev, cur, bold, invert }: { label: string; prev: number; cur: number; bold?: boolean; invert?: boolean }) {
  const delta = prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  const good = delta != null && (invert ? delta <= 0 : delta >= 0);
  return (
    <tr className={`border-b last:border-0 ${bold ? "bg-secondary/30" : ""}`}>
      <td className={`px-4 py-2.5 ${bold ? "font-semibold" : ""}`}>{label}</td>
      <td className="py-2.5 text-right tabular-nums text-muted-foreground">{formatINR(prev)}</td>
      <td className={`py-2.5 text-right tabular-nums ${bold ? "font-bold" : ""}`}>{formatINR(cur)}</td>
      <td className={`py-2.5 text-right tabular-nums pr-4 ${delta == null ? "text-muted-foreground" : good ? "text-emerald-600" : "text-rose-600"}`}>
        {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`}
      </td>
    </tr>
  );
}
