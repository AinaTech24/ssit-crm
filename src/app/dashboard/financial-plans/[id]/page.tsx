import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  ChevronLeft,
  Printer,
  Pencil,
  ScrollText,
  DollarSign,
  TrendingUp,
  Shield,
  Briefcase,
  Target,
  FileText,
  User,
  Heart
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { financialPlans, investors, leads, users } from "@/db/schema";
import { RecordProvenance } from "@/components/common/RecordProvenance";
import {
  recommendedLifeCover,
  emergencyStatus,
  planFeasibility,
  cfpRatios,
  financialAssetsTotal,
  liquidAssetsTotal,
  totalMonthlyEmi as sumMonthlyEmi,
} from "@/lib/financial-plans/analysis";

export const dynamic = "force-dynamic";

export default async function FinancialPlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  requireCap(session.roles, "financial_plan.view", session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const p = await tx
      .select()
      .from(financialPlans)
      .where(eq(financialPlans.id, id))
      .limit(1);

    if (p.length === 0) return null;
    // Non-managers may only view plans they prepared.
    if (!seesAll && p[0].preparedByUserId !== session.userId) return null;

    const plan = p[0];
    // Subject is either a client (investor) or a prospect (lead).
    const subject = plan.investorId
      ? (await tx.select().from(investors).where(eq(investors.id, plan.investorId)).limit(1))[0] ?? null
      : plan.leadId
      ? (await tx.select().from(leads).where(eq(leads.id, plan.leadId)).limit(1))[0] ?? null
      : null;

    const preparedBy = plan.preparedByUserId
      ? await tx.select().from(users).where(eq(users.id, plan.preparedByUserId)).limit(1)
      : null;

    return { plan, client: subject, isLead: !plan.investorId && !!plan.leadId, preparedBy: preparedBy ? preparedBy[0] : null };
  });

  if (!data) notFound();

  const { plan, client, preparedBy } = data;

  // Compute stats details
  const monthlyInc = Number(plan.monthlyIncome ?? 0);
  const monthlyExp = Number(plan.monthlyExpenses ?? 0);
  const surplus = Math.max(0, monthlyInc - monthlyExp);

  const assets = (plan.assets as any[]) || [];
  const liabilities = (plan.liabilities as any[]) || [];
  const totalAssets = assets.reduce((s, a) => s + Number(a.value || 0), 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + Number(l.value || 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  const monthlyEmi = sumMonthlyEmi(liabilities);
  const liquidAssets = liquidAssetsTotal(assets);
  const financialAssets = financialAssetsTotal(assets);

  // Emergency fund — credit the liquid assets already on the balance sheet.
  const emergency = emergencyStatus({
    monthlyExpenses: monthlyExp,
    targetMonths: plan.emergencyFundTargetMonths ?? 6,
    earmarkedFund: Number(plan.emergencyFundCurrentValue ?? 0),
    liquidAssets,
  });
  const targetEmergency = emergency.target;
  const currentEmergency = emergency.available;
  const emergencyGap = emergency.gap;

  const lifeSum = Number(plan.lifeInsuranceSumAssured ?? 0);
  const lifePremium = Number(plan.lifeInsuranceAnnualPremium ?? 0);
  const healthSum = Number(plan.healthInsuranceSumAssured ?? 0);
  const healthPremium = Number(plan.healthInsuranceAnnualPremium ?? 0);

  const goals = (plan.goals as any[]) || [];

  // Life cover — need-analysis (liabilities + goals + PV of family expenses − financial assets).
  const goalsPresentCostTotal = goals.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0);
  const lifeCover = recommendedLifeCover({
    monthlyExpenses: monthlyExp,
    totalLiabilities,
    goalsPresentCostTotal,
    financialAssets,
    existingCover: lifeSum,
  });
  const suggestedLife = Math.round(lifeCover.recommended);

  // New SIP the client must START (net of any per-goal existing provision), and
  // whether the monthly surplus can actually fund it.
  const totalNewSip = goals.reduce(
    (s, g) => s + (g.additionalMonthlySip != null ? Number(g.additionalMonthlySip) : Number(g.requiredMonthlySip) || 0),
    0
  );
  const totalSIPBudget = goals.reduce((s, g) => s + (Number(g.requiredMonthlySip) || 0), 0);
  const feasibility = planFeasibility({
    monthlyIncome: monthlyInc,
    monthlyExpenses: monthlyExp,
    totalMonthlyEmi: monthlyEmi,
    requiredAdditionalSip: totalNewSip,
  });
  const ratios = cfpRatios({
    monthlyIncome: monthlyInc,
    monthlyExpenses: monthlyExp,
    totalMonthlyEmi: monthlyEmi,
    totalAssets,
    totalLiabilities,
    liquidAssets,
  });

  const recommendedEquity = plan.recommendedEquityPct ?? 0;
  const recommendedDebt = plan.recommendedDebtPct ?? 0;
  const recommendedGold = plan.recommendedGoldPct ?? 0;
  const recommendedCash = plan.recommendedCashPct ?? 0;

  const equitySum = assets.filter(a => a.category === 'equity').reduce((s, a) => s + Number(a.value || 0), 0);
  const debtSum = assets.filter(a => a.category === 'debt').reduce((s, a) => s + Number(a.value || 0), 0);
  const goldSum = assets.filter(a => a.category === 'gold').reduce((s, a) => s + Number(a.value || 0), 0);
  const cashSum = assets.filter(a => a.category === 'cash').reduce((s, a) => s + Number(a.value || 0), 0);
  const otherSum = assets.filter(a => a.category === 'real_estate' || a.category === 'other').reduce((s, a) => s + Number(a.value || 0), 0);

  const currentEquityPct = totalAssets ? Math.round((equitySum / totalAssets) * 100) : 0;
  const currentDebtPct = totalAssets ? Math.round((debtSum / totalAssets) * 100) : 0;
  const currentGoldPct = totalAssets ? Math.round((goldSum / totalAssets) * 100) : 0;
  const currentCashPct = totalAssets ? Math.round((cashSum / totalAssets) * 100) : 0;
  const currentOthersPct = totalAssets ? Math.round((otherSum / totalAssets) * 100) : 0;

  const recommendations = (plan.recommendations as any[]) || [];

  // Wealth Health Score Calculations
  const rateSavings = plan.savingsRate ? Number(plan.savingsRate) : (monthlyInc ? Math.round((surplus / monthlyInc) * 100) : 0);
  const emiRatio = plan.emiToIncomePct ? Number(plan.emiToIncomePct) : 0;
  
  const savingsScore = rateSavings >= 30 ? 25 : rateSavings >= 15 ? 15 : rateSavings > 0 ? 5 : 0;
  const debtScore = emiRatio < 30 ? 25 : emiRatio <= 45 ? 15 : 0;
  const emergencyScore = targetEmergency === 0 ? 20 : (currentEmergency >= targetEmergency ? 20 : Math.round((currentEmergency / targetEmergency) * 20));
  const lifeScore = suggestedLife === 0 ? 15 : (lifeSum >= suggestedLife ? 15 : Math.round((lifeSum / suggestedLife) * 15));
  const healthScore = healthSum >= 500000 ? 15 : (healthSum > 0 ? Math.min(15, Math.round((healthSum / 500000) * 15)) : 0);
  
  const healthScoreTotal = savingsScore + debtScore + emergencyScore + lifeScore + healthScore;
  const healthScoreStatus = healthScoreTotal >= 85 ? "Excellent" : healthScoreTotal >= 60 ? "Good" : "Action Required";
  const healthScoreColor = healthScoreTotal >= 85 ? "text-emerald-700 bg-emerald-50 border-emerald-200" : healthScoreTotal >= 60 ? "text-amber-700 bg-amber-50 border-amber-200" : "text-rose-700 bg-rose-50 border-rose-200";

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Detail Header Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link
          href="/dashboard/financial-plans"
          className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="size-4" /> Back to list
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/financial-plans/${plan.id}/print`}
            target="_blank"
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <Printer className="size-3.5" /> Print / Save PDF
          </Link>
          <Link
            href={`/dashboard/financial-plans/new?edit=${plan.id}`}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Pencil className="size-3.5" /> Edit Plan
          </Link>
        </div>
        <RecordProvenance
          entityType="financial_plan"
          entityId={plan.id}
          createdAt={plan.createdAt}
          updatedAt={plan.updatedAt}
          className="basis-full mt-1"
        />
      </div>

      {/* Profile & Health Score Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Overview Card */}
        <div className="card-surface p-6 lg:col-span-2 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-xl bg-brand-cyan-light text-brand-cyan-deep grid place-items-center">
              <ScrollText className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">{client?.name ?? "—"}</h1>
                {data.isLead && (
                  <span className="chip text-[10px] uppercase font-bold bg-amber-100 text-amber-700 border border-amber-200">Lead</span>
                )}
                <span
                  className={`chip text-[10px] uppercase font-bold ${
                    plan.status === "finalized"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {plan.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Financial Plan: <span className="font-semibold text-brand-navy">{plan.planNumber}</span> · Generated {formatDate(plan.preparedAt)}
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-xs border-t md:border-t-0 pt-4 md:pt-0 border-border">
            {plan.clientAge && (
              <div>
                <span className="text-muted-foreground block">Client Age</span>
                <span className="font-bold text-foreground">{plan.clientAge} yrs</span>
              </div>
            )}
            {plan.spouseAge && (
              <div>
                <span className="text-muted-foreground block">Spouse Age</span>
                <span className="font-bold text-foreground">{plan.spouseAge} yrs</span>
              </div>
            )}
            {plan.riskProfile && (
              <div>
                <span className="text-muted-foreground block">Risk Profile</span>
                <span className="font-bold text-foreground capitalize">{plan.riskProfile.replace(/_/g, " ")}</span>
              </div>
            )}
            {preparedBy && (
              <div>
                <span className="text-muted-foreground block">Prepared By</span>
                <span className="font-bold text-foreground truncate max-w-[120px] inline-block">{preparedBy.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Wealth Health Score Card */}
        <div className={`card-surface p-4 border flex flex-col justify-between items-center text-center ${healthScoreColor}`}>
          <div className="w-full flex justify-between items-center border-b pb-1.5 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-extrabold opacity-75">Wealth Health Score</span>
            <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-white/60 border border-current leading-none">
              {healthScoreStatus}
            </span>
          </div>
          <div className="flex items-baseline justify-center gap-1 my-1">
            <span className="text-3xl font-extrabold tabular-nums leading-none">{healthScoreTotal}</span>
            <span className="text-[10px] font-semibold opacity-75">/100</span>
          </div>
          <div className="w-full bg-slate-200/50 h-2 rounded-full overflow-hidden mt-1 mb-2">
            <div
              style={{ width: `${healthScoreTotal}%` }}
              className={`h-full rounded-full ${
                healthScoreTotal >= 85 ? "bg-emerald-600" : healthScoreTotal >= 60 ? "bg-amber-500" : "bg-rose-600"
              }`}
            />
          </div>
          <p className="text-[9px] text-slate-500 leading-tight">
            Covers Savings, Debt, Emergency Fund, Life and Health insurance adequacy.
          </p>
        </div>
      </div>

      {/* Funding feasibility — can the surplus fund the required SIPs? */}
      {totalNewSip > 0 && (
        <div
          className={`card-surface p-4 border flex items-start justify-between gap-4 ${
            feasibility.feasible
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <div>
            <div className="text-sm font-bold">
              {feasibility.feasible ? "Plan is fundable from surplus" : "Plan is under-funded"}
            </div>
            <p className="text-xs mt-0.5 opacity-90 max-w-2xl">
              Investable surplus <strong>{formatINR(feasibility.investableSurplus)}/mo</strong> vs new SIP required{" "}
              <strong>{formatINR(feasibility.requiredAdditionalSip)}/mo</strong>.
              {feasibility.feasible
                ? " The required SIPs fit within the monthly surplus."
                : ` Short by ${formatINR(feasibility.shortfall)}/mo — prioritise goals, extend timelines, or increase income / cut expenses.`}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-extrabold tabular-nums leading-none">
              {feasibility.utilizationPct >= 999 ? "∞" : `${feasibility.utilizationPct}%`}
            </div>
            <div className="text-[10px] uppercase tracking-wider opacity-75">of surplus used</div>
          </div>
        </div>
      )}

      {/* Key planning ratios */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Ratio label="Net worth" value={formatINR(ratios.netWorth)} tone={ratios.netWorth >= 0 ? "good" : "bad"} />
        <Ratio
          label="Liquidity"
          value={`${ratios.liquidityMonths.toFixed(1)} mo`}
          hint="liquid ÷ monthly expense"
          tone={ratios.liquidityMonths >= 3 ? "good" : ratios.liquidityMonths >= 1 ? "warn" : "bad"}
        />
        <Ratio
          label="Savings rate"
          value={`${ratios.savingsRatePct}%`}
          tone={ratios.savingsRatePct >= 30 ? "good" : ratios.savingsRatePct >= 15 ? "warn" : "bad"}
        />
        <Ratio
          label="Debt-to-income"
          value={`${ratios.debtToIncomePct}%`}
          hint="EMIs ÷ income"
          tone={ratios.debtToIncomePct < 30 ? "good" : ratios.debtToIncomePct <= 45 ? "warn" : "bad"}
        />
        <Ratio
          label="Solvency"
          value={`${ratios.solvencyPct}%`}
          hint="net worth ÷ assets"
          tone={ratios.solvencyPct >= 50 ? "good" : ratios.solvencyPct >= 20 ? "warn" : "bad"}
        />
      </div>

      {/* Main Grid Dashboards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Cash Flow Card */}
        <div className="card-surface p-5 space-y-4">
          <h2 className="text-sm font-bold text-brand-navy flex items-center gap-1.5 pb-2 border-b">
            <DollarSign className="size-4 text-emerald-600" /> Income & Expenses
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly Inflow:</span>
              <span className="font-semibold tabular-nums">{formatINR(monthlyInc)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly Outflow:</span>
              <span className="font-semibold tabular-nums text-rose-600">{formatINR(monthlyExp)}</span>
            </div>
            <div className="flex justify-between border-t pt-2.5 font-bold text-emerald-700">
              <span>Monthly Surplus:</span>
              <span className="tabular-nums text-sm">{formatINR(surplus)}</span>
            </div>
            {plan.savingsRate && (
              <div className="flex justify-between text-[11px] pt-1">
                <span className="text-muted-foreground">Savings Rate:</span>
                <span className={`font-bold ${Number(plan.savingsRate) >= 30 ? "text-emerald-700" : Number(plan.savingsRate) >= 15 ? "text-amber-600" : "text-rose-600"}`}>
                  {plan.savingsRate}% ({Number(plan.savingsRate) >= 30 ? "Excellent" : Number(plan.savingsRate) >= 15 ? "Average" : "Low"})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Net Worth Card */}
        <div className="card-surface p-5 space-y-4">
          <h2 className="text-sm font-bold text-brand-navy flex items-center gap-1.5 pb-2 border-b">
            <Briefcase className="size-4 text-brand-cyan" /> Assets & Liabilities
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Assets:</span>
              <span className="font-semibold tabular-nums">{formatINR(totalAssets)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Liabilities:</span>
              <span className="font-semibold tabular-nums text-rose-600">{formatINR(totalLiabilities)}</span>
            </div>
            <div className="flex justify-between border-t pt-2.5 font-bold text-brand-cyan-deep">
              <span>Net Worth:</span>
              <span className="tabular-nums text-sm">{formatINR(netWorth)}</span>
            </div>
            {plan.emiToIncomePct && (
              <div className="flex justify-between text-[11px] pt-1">
                <span className="text-muted-foreground">Debt-to-Income:</span>
                <span className={`font-bold ${Number(plan.emiToIncomePct) > 45 ? "text-rose-600" : Number(plan.emiToIncomePct) >= 30 ? "text-amber-600" : "text-emerald-700"}`}>
                  {plan.emiToIncomePct}% ({Number(plan.emiToIncomePct) > 45 ? "Critical" : Number(plan.emiToIncomePct) >= 30 ? "Moderate" : "Safe"})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Protection & Emergency Card */}
        <div className="card-surface p-5 space-y-4">
          <h2 className="text-sm font-bold text-brand-navy flex items-center gap-1.5 pb-2 border-b">
            <Shield className="size-4 text-blue-600" /> Emergency & Insurance
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Emergency Buffer:</span>
              <span className={`font-semibold tabular-nums ${emergencyGap > 0 ? "text-amber-600" : "text-emerald-700"}`}>
                {emergencyGap > 0 ? `${formatINR(currentEmergency)} / ${formatINR(targetEmergency)}` : "Fully Funded"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Life Coverage:</span>
              <span className={`font-semibold tabular-nums ${lifeCover.additional > 0 ? "text-amber-600" : "text-emerald-700"}`}>
                {formatINR(lifeSum)} / {formatINR(suggestedLife)}
              </span>
            </div>
            {lifeCover.additional > 0 && (
              <div className="flex justify-between text-[11px] text-rose-700">
                <span>Additional term cover needed:</span>
                <span className="font-semibold tabular-nums">{formatINR(Math.round(lifeCover.additional))}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2.5 font-bold">
              <span>Health Coverage:</span>
              <span className="tabular-nums text-emerald-700">{formatINR(healthSum)}</span>
            </div>
          </div>
        </div>

      </div>

      {/* Tab Sections */}
      <div className="space-y-6">
        
        {/* Assets & Liabilities Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card-surface p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assets Breakdown</h3>
            {assets.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No assets added.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {assets.map((a, i) => (
                  <div key={i} className="flex justify-between items-center text-xs p-2 bg-secondary/20 rounded">
                    <div>
                      <span className="font-medium text-foreground">{a.name || "Unnamed"}</span>
                      <span className="text-[10px] text-muted-foreground block capitalize">{a.category}</span>
                    </div>
                    <span className="font-semibold tabular-nums">{formatINR(Number(a.value || 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card-surface p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Liabilities & EMIs</h3>
            {liabilities.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No liabilities added.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {liabilities.map((l, i) => (
                  <div key={i} className="flex justify-between items-center text-xs p-2 bg-secondary/20 rounded">
                    <div>
                      <span className="font-medium text-foreground">{l.name || "Unnamed"}</span>
                      {l.monthlyEmi && (
                        <span className="text-[10px] text-muted-foreground block">EMI: {formatINR(l.monthlyEmi)}/mo</span>
                      )}
                    </div>
                    <span className="font-semibold tabular-nums text-rose-600">{formatINR(Number(l.value || 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Goals Planner */}
        <div className="card-surface p-6 space-y-4">
          <h3 className="text-sm font-bold text-brand-navy flex items-center gap-1.5 pb-2 border-b">
            <Target className="size-5 text-brand-cyan" /> Financial Goals & SIP Calculations
          </h3>
          {goals.length === 0 ? (
            <p className="text-xs italic text-muted-foreground py-4 text-center">No goals targeted in this plan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="pb-2 font-semibold">Goal Name</th>
                    <th className="pb-2 font-semibold capitalize text-center">Category</th>
                    <th className="pb-2 font-semibold text-right">Years</th>
                    <th className="pb-2 font-semibold text-right">Current Cost</th>
                    <th className="pb-2 font-semibold text-right">Inflation</th>
                    <th className="pb-2 font-semibold text-right">Future Cost</th>
                    <th className="pb-2 font-semibold text-right">Exp. Return</th>
                    <th className="pb-2 font-semibold text-right">Required Monthly SIP</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {goals.map((g, i) => (
                    <tr key={i} className="hover:bg-secondary/10 transition-colors">
                      <td className="py-2.5 font-bold text-brand-navy">{g.name}</td>
                      <td className="py-2.5 text-center text-muted-foreground capitalize">{String(g.category).replace(/_/g, " ")}</td>
                      <td className="py-2.5 text-right tabular-nums font-semibold">{g.targetYears} yrs</td>
                      <td className="py-2.5 text-right tabular-nums">{formatINR(g.targetAmount)}</td>
                      <td className="py-2.5 text-right tabular-nums">{g.inflationRate}%</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{formatINR(g.futureValue || 0)}</td>
                      <td className="py-2.5 text-right tabular-nums">{g.expectedReturn}%</td>
                      <td className="py-2.5 text-right font-bold text-emerald-700 tabular-nums">{formatINR(g.requiredMonthlySip || 0)}/mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {goals.length > 0 && (
            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-between text-xs font-bold text-emerald-800">
              <span>Goal SIP Budget Total:</span>
              <span className="tabular-nums text-sm">{formatINR(totalSIPBudget)} /mo</span>
            </div>
          )}
        </div>

        {/* Suggested Asset Allocation & Roadmap */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Allocation Comparison Card */}
          <div className="card-surface p-5 space-y-4 md:col-span-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-2 border-b">
              Asset Allocation: Current vs Suggested
            </h3>
            <div className="space-y-3.5 text-xs">
              {[
                { name: "Equity", color: "bg-emerald-500", curr: currentEquityPct, rec: recommendedEquity },
                { name: "Debt", color: "bg-blue-500", curr: currentDebtPct, rec: recommendedDebt },
                { name: "Gold", color: "bg-amber-500", curr: currentGoldPct, rec: recommendedGold },
                { name: "Cash", color: "bg-slate-500", curr: currentCashPct, rec: recommendedCash },
                { name: "Others", color: "bg-purple-500", curr: currentOthersPct, rec: 0 }
              ].map((a, index) => {
                const deviation = a.rec - a.curr;
                if (a.rec === 0 && a.curr === 0 && a.name === "Others") return null;
                return (
                  <div key={index} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span className={`size-2.5 rounded ${a.color} inline-block`} />
                        {a.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {a.curr}% vs <strong className="text-foreground">{a.rec}%</strong>
                        {a.name !== "Others" && (
                          <span className={`ml-1 font-bold ${deviation > 0 ? "text-emerald-600" : deviation < 0 ? "text-rose-600" : "text-slate-500"}`}>
                            ({deviation > 0 ? `+${deviation}` : deviation}%)
                          </span>
                        )}
                      </span>
                    </div>
                    {/* Visual Comparison Progress bars */}
                    <div className="space-y-0.5">
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex" title={`Current: ${a.curr}%`}>
                        <div style={{ width: `${a.curr}%` }} className={`h-full ${a.color} opacity-40`} />
                      </div>
                      {a.name !== "Others" && (
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden flex" title={`Recommended: ${a.rec}%`}>
                          <div style={{ width: `${a.rec}%` }} className={`h-full ${a.color}`} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Recommendations */}
          <div className="card-surface p-5 space-y-3 md:col-span-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-2 border-b">Action Roadmap Recommendations</h3>
            {recommendations.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No specific action items added.</p>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {recommendations.map((r, i) => (
                  <div key={i} className="bg-secondary/15 border p-2.5 rounded text-xs space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="chip text-[9px] uppercase font-bold bg-brand-cyan-light text-brand-cyan-deep">
                        {r.category}
                      </span>
                      <span className={`text-[9px] font-bold uppercase ${
                        r.priority === "high"
                          ? "text-rose-600"
                          : r.priority === "medium"
                          ? "text-amber-600"
                          : "text-slate-500"
                      }`}>
                        {r.priority} Priority
                      </span>
                    </div>
                    <p className="font-semibold text-foreground leading-snug">{r.action}</p>
                    {r.notes && <p className="text-[10px] text-muted-foreground">{r.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* General Notes */}
        {plan.notes && (
          <div className="card-surface p-5 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Assumptions & Client Remarks</h3>
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{plan.notes}</p>
          </div>
        )}

      </div>
    </div>
  );
}

function Ratio({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-600"
        : "text-rose-600";
  return (
    <div className="card-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}
