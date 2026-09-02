import Link from "next/link";
import { eq, desc, sql, and, or, ilike, inArray } from "drizzle-orm";
import {
  Plus,
  ScrollText,
  Users,
  TrendingUp,
  ShieldCheck,
  ChevronRight,
  Briefcase,
  Printer,
  FileText
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { Pager } from "@/components/common/Pager";
import { Avatar } from "@/components/ui/Avatar";
import { PdfRow } from "@/components/common/ClickableRow";
import { financialPlans, investors, leads } from "@/db/schema";

export const dynamic = "force-dynamic";


const STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  finalized: "bg-emerald-50 text-emerald-700 border border-emerald-200/50",
};

export default async function FinancialPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // The most sensitive client data in the app (income, assets, liabilities) —
  // require the view capability and scope non-managers to plans they prepared
  // (the page had NO gate and showed firm-wide net-worth/surplus KPIs to any
  // role).
  requireCap(session.roles, "financial_plan.view", session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Server-side filter (was filtered in JS over the whole table before).
    const conds: any[] = [];
    if (!seesAll) conds.push(eq(financialPlans.preparedByUserId, session.userId));
    if (q) conds.push(or(ilike(financialPlans.planNumber, `%${q}%`), ilike(investors.name, `%${q}%`), ilike(leads.name, `%${q}%`)));
    if (statusFilter.length) conds.push(inArray(financialPlans.status, statusFilter as any));
    const dr = dateRangeCond(sp, "created", "financial_plans.created_at");
    if (dr) conds.push(dr);
    const where = conds.length ? and(...conds) : undefined;
    // Same owner slice for the raw-SQL KPI aggregate below.
    const statsScope = seesAll ? sql`` : sql` WHERE prepared_by_user_id = ${session.userId}::uuid`;

    // One page of filtered rows.
    const rows = await tx
      .select({
        id: financialPlans.id,
        planNumber: financialPlans.planNumber,
        investorId: financialPlans.investorId,
        leadId: financialPlans.leadId,
        status: financialPlans.status,
        monthlyIncome: financialPlans.monthlyIncome,
        monthlyExpenses: financialPlans.monthlyExpenses,
        preparedAt: financialPlans.preparedAt,
        investorName: investors.name,
        leadName: leads.name,
        investorAvatarUrl: investors.avatarUrl,
      })
      .from(financialPlans)
      .leftJoin(investors, eq(financialPlans.investorId, investors.id))
      .leftJoin(leads, eq(financialPlans.leadId, leads.id))
      .where(where)
      .orderBy(desc(financialPlans.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    // Filtered total (pager) — subject joins needed for name search.
    const cnt = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(financialPlans)
      .leftJoin(investors, eq(financialPlans.investorId, investors.id))
      .leftJoin(leads, eq(financialPlans.leadId, leads.id))
      .where(where);

    // Book-wide KPIs aggregated in SQL (was summed in JS over every plan).
    // jsonb_array_elements expands assets/liabilities to sum their values.
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total_plans,
        COALESCE(SUM(GREATEST(0, COALESCE(monthly_income::numeric, 0) - COALESCE(monthly_expenses::numeric, 0))), 0)::numeric AS total_surplus,
        COALESCE(SUM((SELECT COALESCE(SUM((a->>'value')::numeric), 0) FROM jsonb_array_elements(COALESCE(assets, '[]'::jsonb)) a)), 0)::numeric AS total_assets,
        COALESCE(SUM((SELECT COALESCE(SUM((l->>'value')::numeric), 0) FROM jsonb_array_elements(COALESCE(liabilities, '[]'::jsonb)) l)), 0)::numeric AS total_liabilities
      FROM financial_plans${statsScope}
    `);

    return {
      rows,
      filteredTotal: Number(cnt[0]?.c ?? 0),
      s: stats.rows[0] as any,
    };
  });

  const filteredRows = data.rows;
  const totalPlans = Number(data.s.total_plans ?? 0);
  const totalSurplus = Number(data.s.total_surplus ?? 0);
  const totalNetWorth = Number(data.s.total_assets ?? 0) - Number(data.s.total_liabilities ?? 0);
  const avgSurplus = totalPlans > 0 ? totalSurplus / totalPlans : 0;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <ScrollText className="size-6 text-brand-cyan" /> Financial Plans
          </h1>
        </div>
        <Link href="/dashboard/financial-plans/new" className="btn-primary">
          <Plus className="size-4" /> Create Financial Plan
        </Link>
      </div>

      {/* Filter and Table Container */}
      <div className="space-y-4">
        <CompactFilterBar
          totalCount={data.filteredTotal}
          rightSlot={<CustomViews viewsKey="views:financial-plans" />}
          filters={[
            { type: "search", key: "q", placeholder: "Search by plan # or client name..." },
            {
              type: "multi",
              key: "status",
              label: "Status",
              options: [
                { value: "draft", label: "Draft" },
                { value: "finalized", label: "Finalized" },
              ],
            },
            dateRangeFilter("created", "Created"),
          ]}
        />

        <div className="card-surface">
          {filteredRows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <ScrollText className="size-8 mx-auto text-muted-foreground/50 mb-2" />
              <div className="font-semibold text-foreground">No financial plans found</div>
              <p className="mt-1 max-w-sm mx-auto text-xs text-muted-foreground">
                {q || statusFilter.length
                  ? "Try adjusting your filters or search term to see other plans."
                  : "Click 'Create Financial Plan' to generate your first detailed financial proposal for a client."}
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-xs text-muted-foreground bg-secondary/20">
                    <th className="text-left font-semibold py-3 px-4">Plan Number</th>
                    <th className="text-left font-semibold py-3 px-4">Client Name</th>
                    <th className="text-right font-semibold py-3 px-4">Monthly Income</th>
                    <th className="text-right font-semibold py-3 px-4">Monthly Expenses</th>
                    <th className="text-right font-semibold py-3 px-4">Monthly Surplus</th>
                    <th className="text-center font-semibold py-3 px-4">Status</th>
                    <th className="text-left font-semibold py-3 px-4">Prepared At</th>
                    <th className="text-right font-semibold py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRows.map((p, idx) => {
                    const inc = Number(p.monthlyIncome ?? 0);
                    const exp = Number(p.monthlyExpenses ?? 0);
                    const surplus = Math.max(0, inc - exp);
                    const seq = (page - 1) * PAGE_SIZE + idx + 1;
                    return (
                      <PdfRow
                        key={p.id}
                        title={`Financial Plan · ${p.investorName ?? p.leadName ?? p.planNumber ?? ""}`}
                        pdfUrl={`/dashboard/financial-plans/${p.id}/print`}
                        className="hover:bg-secondary/20 transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-brand-navy">
                          <Link href={`/dashboard/financial-plans/${p.id}`} className="hover:underline" title={p.planNumber ?? undefined}>
                            {seq}
                          </Link>
                        </td>
                        <td className="py-3 px-4 font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            <Avatar src={p.investorAvatarUrl && p.investorId ? `/api/investors/${p.investorId}/avatar` : null} name={p.investorName ?? p.leadName} size={26} />
                            <span className="flex items-center gap-1.5">
                              {p.investorName ?? p.leadName ?? "—"}
                              {!p.investorId && p.leadId && <span className="chip text-[9px] bg-amber-100 text-amber-700">Lead</span>}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">{p.monthlyIncome ? formatINR(inc) : "—"}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{p.monthlyExpenses ? formatINR(exp) : "—"}</td>
                        <td className="py-3 px-4 text-right font-semibold text-emerald-600 tabular-nums">
                          {formatINR(surplus)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`chip text-xs ${STATUS_TONE[p.status] ?? ""}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{formatDate(p.preparedAt)}</td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/dashboard/financial-plans/${p.id}/print`}
                              target="_blank"
                              className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground"
                              title="Print PDF"
                            >
                              <Printer className="size-4" />
                            </Link>
                            <Link
                              href={`/dashboard/financial-plans/${p.id}`}
                              className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground"
                              title="View Plan"
                            >
                              <ChevronRight className="size-4" />
                            </Link>
                            <RowActions
                              inline
                              editHref={`/dashboard/financial-plans/new?edit=${p.id}`}
                              deleteUrl={`/api/financial-plans/${p.id}`}
                              itemLabel="financial plan"
                              itemName={p.planNumber}
                            />
                          </div>
                        </td>
                      </PdfRow>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 pb-3">
                <Pager
                  page={page}
                  totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)}
                  total={data.filteredTotal}
                  pageSize={PAGE_SIZE}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  subtext?: string;
  tone?: "rose" | "amber" | "emerald" | "cyan" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : tone === "cyan"
            ? "text-brand-cyan-deep"
            : "text-foreground";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : tone === "amber"
        ? "bg-amber-50 text-amber-600"
        : tone === "emerald"
          ? "bg-emerald-50 text-emerald-600"
          : tone === "cyan"
            ? "bg-brand-cyan-light text-brand-cyan-deep"
            : "bg-secondary text-muted-foreground";

  return (
    <div className="kpi-card bg-card border border-border/60 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-8 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
      {subtext && <p className="text-[10px] text-muted-foreground mt-1">{subtext}</p>}
    </div>
  );
}
