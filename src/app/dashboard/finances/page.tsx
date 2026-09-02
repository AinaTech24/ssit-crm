/**
 * Finances hub (Network FP Module 8) — the MFD's own business finances.
 * Live overview (this-FY profit, margin, income, expenses, YoY trend, top
 * expense) on top of links to the ledger, P&L, progress, projections and the
 * finance checklist. Gated by finances.view (owner + back-office only).
 */

import Link from "next/link";
import {
  Wallet,
  Receipt,
  Scale,
  Target,
  TrendingUp,
  CheckSquare,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { formatINR } from "@/lib/utils";
import { currentFyLabel } from "@/lib/finance/fiscal-year";
import { getPracticeSummary } from "@/lib/finance/practice-summary";

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

const CARDS = [
  {
    href: "/dashboard/finances/expenses",
    icon: Receipt,
    title: "Expense ledger",
    desc: "Record and categorise every business expense, month by month.",
  },
  {
    href: "/dashboard/finances/pnl",
    icon: Scale,
    title: "P&L statement",
    desc: "Commission income minus expenses → net profit, by fiscal year.",
  },
  {
    href: "/dashboard/finances/progress",
    icon: Target,
    title: "Monthly progress",
    desc: "Annual targets vs live actuals — clients, AUM, SIP, lumpsum.",
  },
  {
    href: "/dashboard/reports/business-projections",
    icon: TrendingUp,
    title: "Business projections",
    desc: "Project AUM & commission income over the next 10 years.",
  },
  {
    href: "/dashboard/reports/financial-checklist",
    icon: CheckSquare,
    title: "Finance checklist",
    desc: "Daily → annual bookkeeping, tax & compliance cadence.",
  },
];

export default async function FinancesHubPage() {
  const session = await requireSession();
  requireCap(session.roles, "finances.view", session.permissions);

  const fy = currentFyLabel();
  const s = await withTenant(
    session.tenantId,
    (tx) => getPracticeSummary(tx, session.tenantId, fy),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const profitDelta =
    s.prev.netProfit !== 0 ? ((s.netProfit - s.prev.netProfit) / Math.abs(s.prev.netProfit)) * 100 : null;
  const hasData = s.income.net > 0 || s.expenses.total > 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="size-6 text-brand-cyan" /> Practice finances
          </h1>
        </div>
        <span className="text-xs text-muted-foreground">FY {fy}</span>
      </div>

      {/* Live overview */}
      {hasData ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Net profit" value={formatINR(s.netProfit)} tone={s.netProfit >= 0 ? "emerald" : "rose"}
            delta={profitDelta} deltaLabel="vs last FY" />
          <Kpi label="Net margin" value={s.margin != null ? `${s.margin.toFixed(1)}%` : "—"} tone="cyan" />
          <Kpi label="Income (net commission)" value={formatINR(s.income.net)} tone="emerald" />
          <Kpi label="Expenses" value={formatINR(s.expenses.total)} tone="rose"
            sub={s.topExpense ? `Top: ${CAT_LABEL[s.topExpense.category] ?? s.topExpense.category}` : undefined} />
        </div>
      ) : (
        <div className="card-surface p-4 text-sm text-muted-foreground">
          No income or expenses recorded for FY {fy} yet. Add expenses in the ledger and import commission
          payouts to light up your live P&amp;L here.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="card-surface glass-card p-5 hover-lift group flex flex-col"
            >
              <div className="size-9 rounded-lg bg-brand-cyan-light grid place-items-center mb-3">
                <Icon className="size-4.5 text-brand-cyan-deep" />
              </div>
              <div className="font-semibold text-sm flex items-center gap-1">
                {c.title}
                <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{c.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  delta,
  deltaLabel,
  sub,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "cyan";
  delta?: number | null;
  deltaLabel?: string;
  sub?: string;
}) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-brand-cyan-deep";
  return (
    <div className="card-surface glass-card p-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${cls}`}>{value}</div>
      {delta != null && (
        <div className={`text-[11px] mt-0.5 inline-flex items-center gap-0.5 ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {Math.abs(delta).toFixed(0)}% {deltaLabel}
        </div>
      )}
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
