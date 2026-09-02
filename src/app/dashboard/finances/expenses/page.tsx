/**
 * Expense Ledger (Network FP 8.2) — firm expense bookkeeping.
 * Gated by reports.commission. FY selectable via ?fy=YYYY-YY.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { businessExpenses, recurringExpenses, expenseBudgets } from "@/db/schema";
import { currentFyLabel, fyBounds, recentFyLabels } from "@/lib/finance/fiscal-year";
import { ExpenseLedger } from "@/components/finances/ExpenseLedger";
import { RecurringExpenses } from "@/components/finances/RecurringExpenses";
import { BudgetVsActual } from "@/components/finances/BudgetVsActual";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "finances.view", session.permissions);
  const sp = await searchParams;
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : currentFyLabel();
  const bounds = fyBounds(fy);

  // Current calendar month — drives recurring-post + budget-vs-actual.
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleString("en-US", { month: "short", year: "numeric" });
  const monthStart = `${currentPeriod}-01`;
  const monthEnd = `${currentPeriod}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;

  const { rows, templates, budgets, monthActuals } = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(businessExpenses)
      .where(
        and(
          eq(businessExpenses.tenantId, session.tenantId),
          gte(businessExpenses.expenseDate, bounds.startISO),
          lte(businessExpenses.expenseDate, bounds.endISO)
        )
      )
      .orderBy(desc(businessExpenses.expenseDate), desc(businessExpenses.createdAt))
      .limit(1000);

    const templates = await tx
      .select()
      .from(recurringExpenses)
      .where(eq(recurringExpenses.tenantId, session.tenantId))
      .orderBy(desc(recurringExpenses.createdAt));

    const budgetRows = await tx.select().from(expenseBudgets).where(eq(expenseBudgets.tenantId, session.tenantId));
    const budgets: Record<string, number> = {};
    for (const b of budgetRows) budgets[b.category] = Number(b.monthlyBudget);

    const actualRows = await tx.execute(sql`
      SELECT category, COALESCE(SUM(amount::numeric),0) AS total
      FROM business_expenses
      WHERE tenant_id = ${session.tenantId} AND expense_date >= ${monthStart}::date AND expense_date <= ${monthEnd}::date
      GROUP BY category
    `);
    const monthActuals: Record<string, number> = {};
    for (const r of actualRows.rows as any[]) monthActuals[r.category] = Number(r.total);

    return { rows, templates, budgets, monthActuals };
  });

  const serialised = rows.map((r) => ({
    id: r.id,
    expenseDate: String(r.expenseDate),
    description: r.description,
    category: r.category,
    paidFrom: r.paidFrom,
    amount: String(r.amount),
    notes: r.notes ?? null,
  }));

  const fyOptions = recentFyLabels(4);

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link href="/dashboard/finances" className="hover:underline inline-flex items-center gap-1">
            <ChevronLeft className="size-3" /> Finances
          </Link>
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Expense ledger</h1>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
            {fyOptions.map((y) => (
              <Link
                key={y}
                href={`/dashboard/finances/expenses?fy=${y}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${y === fy ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                FY {y}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RecurringExpenses
          currentPeriod={currentPeriod}
          initial={templates.map((t) => ({
            id: t.id,
            description: t.description,
            category: t.category,
            paidFrom: t.paidFrom,
            amount: String(t.amount),
            dayOfMonth: t.dayOfMonth,
            active: t.active,
          }))}
        />
        <BudgetVsActual monthLabel={monthLabel} actuals={monthActuals} initialBudgets={budgets} />
      </div>

      <ExpenseLedger fy={fy} initial={serialised} />
    </div>
  );
}
