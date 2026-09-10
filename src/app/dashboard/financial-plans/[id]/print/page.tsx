import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { financialPlans, tenants, users, investors, leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { PlanPrintHelper } from "@/components/financial-plans/PlanPrintHelper";
import { FirmLogo } from "@/components/common/FirmLogo";
import {
  recommendedLifeCover,
  emergencyStatus,
  liquidAssetsTotal,
  financialAssetsTotal,
} from "@/lib/financial-plans/analysis";

export const dynamic = "force-dynamic";

export default async function FinancialPlanPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  requireCap(session.roles, "financial_plan.view", session.permissions);
  const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const p = (
      await tx.select().from(financialPlans).where(eq(financialPlans.id, id)).limit(1)
    )[0];
    if (!p) return null;
    // Non-managers may only view plans they prepared.
    if (!seesAll && p.preparedByUserId !== session.userId) return null;

    const tenant = (
      await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
    )[0];

    // Subject is either a client (investor) or a prospect (lead).
    const subject = p.investorId
      ? (await tx.select().from(investors).where(eq(investors.id, p.investorId)).limit(1))[0]
      : p.leadId
      ? (await tx.select().from(leads).where(eq(leads.id, p.leadId)).limit(1))[0]
      : null;

    const preparedBy = p.preparedByUserId
      ? (await tx.select().from(users).where(eq(users.id, p.preparedByUserId)).limit(1))[0]
      : null;

    return { p, tenant, client: subject ?? null, preparedBy };
  });

  if (!data) notFound();

  const { p, tenant, client, preparedBy } = data;

  const primary = (tenant as any)?.primaryColor || "#841f21";
  const accent = (tenant as any)?.accentColor || "#d22e32";

  const monthlyInc = Number(p.monthlyIncome ?? 0);
  const monthlyExp = Number(p.monthlyExpenses ?? 0);
  const surplus = Math.max(0, monthlyInc - monthlyExp);

  const assets = (p.assets as any[]) || [];
  const liabilities = (p.liabilities as any[]) || [];
  const totalAssets = assets.reduce((s, a) => s + Number(a.value || 0), 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + Number(l.value || 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  const emergency = emergencyStatus({
    monthlyExpenses: monthlyExp,
    targetMonths: p.emergencyFundTargetMonths ?? 6,
    earmarkedFund: Number(p.emergencyFundCurrentValue ?? 0),
    liquidAssets: liquidAssetsTotal(assets),
  });
  const targetEmergency = emergency.target;
  const currentEmergency = emergency.available;
  const emergencyGap = emergency.gap;

  const lifeSum = Number(p.lifeInsuranceSumAssured ?? 0);
  const healthSum = Number(p.healthInsuranceSumAssured ?? 0);

  const goals = (p.goals as any[]) || [];
  // Need-analysis life cover (not 10× income).
  const requiredLife = Math.round(
    recommendedLifeCover({
      monthlyExpenses: monthlyExp,
      totalLiabilities,
      goalsPresentCostTotal: goals.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0),
      financialAssets: financialAssetsTotal(assets),
      existingCover: lifeSum,
    }).recommended
  );
  // New SIP to start, net of money already earmarked per goal.
  const totalSip = goals.reduce(
    (s, g) => s + (g.additionalMonthlySip != null ? Number(g.additionalMonthlySip) : Number(g.requiredMonthlySip) || 0),
    0
  );
  const recommendations = (p.recommendations as any[]) || [];

  const recommendedEquity = p.recommendedEquityPct ?? 0;
  const recommendedDebt = p.recommendedDebtPct ?? 0;
  const recommendedGold = p.recommendedGoldPct ?? 0;
  const recommendedCash = p.recommendedCashPct ?? 0;

  // Compute Current Asset Allocations
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

  // Wealth Health Score
  const rateSavings = p.savingsRate ? Number(p.savingsRate) : (monthlyInc ? Math.round((surplus / monthlyInc) * 100) : 0);
  const emiRatio = p.emiToIncomePct ? Number(p.emiToIncomePct) : 0;
  
  const savingsScore = rateSavings >= 30 ? 25 : rateSavings >= 15 ? 15 : rateSavings > 0 ? 5 : 0;
  const debtScore = emiRatio < 30 ? 25 : emiRatio <= 45 ? 15 : 0;
  const emergencyScore = targetEmergency === 0 ? 20 : (currentEmergency >= targetEmergency ? 20 : Math.round((currentEmergency / targetEmergency) * 20));
  const lifeScore = requiredLife === 0 ? 15 : (lifeSum >= requiredLife ? 15 : Math.round((lifeSum / requiredLife) * 15));
  const healthScore = healthSum >= 500000 ? 15 : (healthSum > 0 ? Math.min(15, Math.round((healthSum / 500000) * 15)) : 0);
  
  const healthScoreTotal = savingsScore + debtScore + emergencyScore + lifeScore + healthScore;
  const healthScoreStatus = healthScoreTotal >= 85 ? "Excellent" : healthScoreTotal >= 60 ? "Good" : "Action Required";

  return (
    <>

      <PlanPrintHelper planId={p.id} recipientName={client?.name ?? "Client"} />

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm 10mm; }
          body { background: white !important; }
        }
        .fp-page {
          background: white;
          color: #0f172a;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px 24px 40px;
          font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
        }
        .fp-h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
        .fp-h2 { font-size: 13px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: ${primary}; }
        .fp-muted { color: #64748b; }
        .fp-strip {
          height: 4px; border-radius: 3px;
          background: linear-gradient(90deg, ${primary} 0%, ${primary}cc 55%, ${primary}33 100%);
          margin: 12px 0 16px;
        }
        .fp-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .fp-table th, .fp-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: middle; }
        .fp-table th { background: #f8fafc; font-weight: 700; color: #475569; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
        .fp-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
        .fp-chip { display: inline-block; padding: 2px 8px; font-size: 9px; font-weight: 700; border-radius: 999px; background: ${primary}10; color: ${primary}; }
        .fp-section { page-break-inside: avoid; margin-top: 20px; }
        .fp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .page-break-before { page-break-before: always; }
      `}</style>

      <div className="fp-page">
        {/* Letterhead */}
        <div className="flex items-center justify-between gap-4">
          {/* Logo only — it already carries the firm name, so no duplicate text
              next to it (consistent with the other report headers). */}
          <FirmLogo
            src={tenant?.logoUrl}
            name={tenant?.displayName ?? tenant?.legalName}
            color={primary}
            size={46}
            radius={8}
            maxWidth={210}
          />
          <div style={{ textAlign: "right" }}>
            <div className="fp-chip">{p.planNumber}</div>
            <div className="fp-muted" style={{ fontSize: 10, marginTop: 3 }}>
              Prepared {formatDate(p.preparedAt)}
            </div>
            <div className="fp-muted" style={{ fontSize: 10 }}>
              ARN {(tenant?.arn ?? "").replace(/^ARN-?/i, "")}
            </div>
          </div>
        </div>

        <div className="fp-strip" />

        {/* Title */}
        <div className="fp-h2" style={{ marginBottom: 2 }}>Detailed Wealth Roadmap</div>
        <div className="fp-h1">Personal Financial Plan</div>

        {/* Prepared For / Prepared By / Health Score Info */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.2fr", gap: 16, marginTop: 16 }}>
          <div>
            <div className="fp-muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
              Prepared for
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {client?.name ?? "—"}
            </div>
            <div className="fp-muted" style={{ fontSize: 10, marginTop: 1 }}>
              {client?.email ?? "—"} {client?.phone ? ` · ${client.phone}` : ""}
            </div>
            <div style={{ fontSize: 10, marginTop: 2 }}>
              {(p.clientAge || p.spouseAge) && (
                <span>Age: {p.clientAge ?? "—"} yrs {p.spouseAge ? ` (Spouse: ${p.spouseAge} yrs)` : ""} · </span>
              )}
              {p.riskProfile && (
                <span>Risk Profile: <span style={{ textTransform: "capitalize", fontWeight: 700 }}>{p.riskProfile.replace(/_/g, " ")}</span></span>
              )}
            </div>
          </div>
          <div>
            <div className="fp-muted" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
              Prepared by
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {preparedBy?.name ?? "—"}
            </div>
            <div className="fp-muted" style={{ fontSize: 10, marginTop: 1 }}>
              {(preparedBy as any)?.email ?? "—"}{(preparedBy as any)?.euin ? ` · EUIN ${(preparedBy as any).euin}` : ""}
            </div>
          </div>
          <div className="fp-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "8px 12px" }}>
            <div className="fp-muted" style={{ fontSize: 8, textTransform: "uppercase", fontWeight: 700 }}>
              Wealth Health Score
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: healthScoreTotal >= 85 ? "#059669" : healthScoreTotal >= 60 ? "#d97706" : "#dc2626", margin: "2px 0" }}>
              {healthScoreTotal} <span style={{ fontSize: 10, color: "#64748b", fontWeight: 500 }}>/ 100</span>
            </div>
            <div style={{ fontSize: 9, fontStyle: "italic", fontWeight: 700, color: healthScoreTotal >= 85 ? "#059669" : healthScoreTotal >= 60 ? "#d97706" : "#dc2626" }}>
              Status: {healthScoreStatus}
            </div>
          </div>
        </div>

        {/* Monthly Cash Flow & Net Worth Summary */}
        <div className="fp-grid-2 fp-section">
          <div className="fp-card">
            <div className="fp-muted" style={{ fontSize: 9, textTransform: "uppercase", fontWeight: 700 }}>Cash Flow Surplus</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6, fontSize: 11 }}>
              <div>
                <span className="fp-muted">Income:</span>
                <div style={{ fontWeight: 700 }}>{formatINR(monthlyInc)}</div>
              </div>
              <div>
                <span className="fp-muted">Expenses:</span>
                <div style={{ fontWeight: 700, color: "#e11d48" }}>{formatINR(monthlyExp)}</div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 8, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ fontWeight: 700 }}>Monthly Surplus:</span>
              <span style={{ fontWeight: 800, color: "#059669" }}>{formatINR(surplus)}</span>
            </div>
            {p.savingsRate && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 3 }}>
                <span className="fp-muted">Savings Rate:</span>
                <span style={{ fontWeight: 750 }}>
                  {p.savingsRate}% ({Number(p.savingsRate) >= 30 ? "Excellent" : Number(p.savingsRate) >= 15 ? "Average" : "Low"})
                </span>
              </div>
            )}
          </div>

          <div className="fp-card">
            <div className="fp-muted" style={{ fontSize: 9, textTransform: "uppercase", fontWeight: 700 }}>Net Worth Statement</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6, fontSize: 11 }}>
              <div>
                <span className="fp-muted">Total Assets:</span>
                <div style={{ fontWeight: 700 }}>{formatINR(totalAssets)}</div>
              </div>
              <div>
                <span className="fp-muted">Liabilities:</span>
                <div style={{ fontWeight: 700, color: "#e11d48" }}>{formatINR(totalLiabilities)}</div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 8, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ fontWeight: 700 }}>Net Worth:</span>
              <span style={{ fontWeight: 800, color: `${primary}` }}>{formatINR(netWorth)}</span>
            </div>
            {p.emiToIncomePct && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 3 }}>
                <span className="fp-muted">Debt-to-Income:</span>
                <span style={{ fontWeight: 750 }}>
                  {p.emiToIncomePct}% ({Number(p.emiToIncomePct) > 45 ? "Critical" : Number(p.emiToIncomePct) >= 30 ? "Moderate" : "Safe"})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Protection & Adequacy Details */}
        <div className="fp-section">
          <div className="fp-h2">Risk Protection & Contingency Analysis</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10, marginTop: 6 }} className="text-xs">
            <div className="fp-card">
              <div className="fp-muted" style={{ fontSize: 9, fontWeight: 700 }}>Emergency Fund</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {emergencyGap > 0 ? (
                  <span style={{ color: "#d97706" }}>Shortfall: {formatINR(emergencyGap)}</span>
                ) : (
                  <span style={{ color: "#059669" }}>Fully Funded (No gap)</span>
                )}
              </div>
              <div className="fp-muted" style={{ fontSize: 10, marginTop: 2 }}>
                Current: {formatINR(currentEmergency)} / Required: {formatINR(targetEmergency)}
              </div>
            </div>

            <div className="fp-card">
              <div className="fp-muted" style={{ fontSize: 9, fontWeight: 700 }}>Life Insurance Adequacy</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {lifeSum < requiredLife ? (
                  <span style={{ color: "#d97706" }}>Gap: {formatINR(requiredLife - lifeSum)}</span>
                ) : (
                  <span style={{ color: "#059669" }}>Adequate Cover</span>
                )}
              </div>
              <div className="fp-muted" style={{ fontSize: 10, marginTop: 2 }}>
                Current: {formatINR(lifeSum)} / Target: {formatINR(requiredLife)}
              </div>
            </div>

            <div className="fp-card">
              <div className="fp-muted" style={{ fontSize: 9, fontWeight: 700 }}>Health Insurance cover</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {healthSum >= 500000 ? (
                  <span style={{ color: "#059669" }}>Active cover: {formatINR(healthSum)}</span>
                ) : (
                  <span style={{ color: "#e11d48" }}>Under-insured (₹{formatINR(healthSum)})</span>
                )}
              </div>
              <div className="fp-muted" style={{ fontSize: 10, marginTop: 2 }}>
                Suggested Min: ₹5,00,000 Family Floater
              </div>
            </div>
          </div>
        </div>

        {/* Goals Planner Sheet */}
        {goals.length > 0 && (
          <div className="fp-section page-break-before">
            <div className="fp-h2">Goal-based Investment Planner</div>
            <table className="fp-table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>Goal Name</th>
                  <th style={{ textAlign: "right" }}>Target Years</th>
                  <th style={{ textAlign: "right" }}>Current Value</th>
                  <th style={{ textAlign: "right" }}>Assumed Inflation</th>
                  <th style={{ textAlign: "right" }}>Inflation Adjusted Cost</th>
                  <th style={{ textAlign: "right" }}>Exp. Returns</th>
                  <th style={{ textAlign: "right" }}>Required Monthly SIP</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((g, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 700 }}>{g.name}</td>
                    <td style={{ textAlign: "right" }}>{g.targetYears} yrs</td>
                    <td style={{ textAlign: "right" }}>{formatINR(g.targetAmount)}</td>
                    <td style={{ textAlign: "right" }}>{g.inflationRate}%</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{formatINR(g.futureValue || 0)}</td>
                    <td style={{ textAlign: "right" }}>{g.expectedReturn}%</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#059669" }}>
                      {formatINR(g.requiredMonthlySip || 0)}/mo
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
                  <td colSpan={6} style={{ padding: "8px 8px" }}>Total Budget Goal SIP required</td>
                  <td style={{ textAlign: "right", padding: "8px 8px", color: "#059669" }}>
                    {formatINR(totalSip)}/mo
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Recommended Allocation & Recommendations Roadmap */}
        <div className="fp-grid-2 fp-section">
          <div>
            <div className="fp-h2">Asset Allocation Deviation</div>
            <table className="fp-table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>Asset Class</th>
                  <th style={{ textAlign: "right" }}>Current %</th>
                  <th style={{ textAlign: "right" }}>Suggested %</th>
                  <th style={{ textAlign: "right" }}>Deviation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Equity / Growth Funds</td>
                  <td style={{ textAlign: "right" }}>{currentEquityPct}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{recommendedEquity}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: recommendedEquity - currentEquityPct > 0 ? "#059669" : recommendedEquity - currentEquityPct < 0 ? "#dc2626" : "#475569" }}>
                    {recommendedEquity - currentEquityPct > 0 ? `+${recommendedEquity - currentEquityPct}` : recommendedEquity - currentEquityPct}%
                  </td>
                </tr>
                <tr>
                  <td>Debt / Fixed Income</td>
                  <td style={{ textAlign: "right" }}>{currentDebtPct}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{recommendedDebt}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: recommendedDebt - currentDebtPct > 0 ? "#059669" : recommendedDebt - currentDebtPct < 0 ? "#dc2626" : "#475569" }}>
                    {recommendedDebt - currentDebtPct > 0 ? `+${recommendedDebt - currentDebtPct}` : recommendedDebt - currentDebtPct}%
                  </td>
                </tr>
                <tr>
                  <td>Gold Mutual Funds / SGBs</td>
                  <td style={{ textAlign: "right" }}>{currentGoldPct}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{recommendedGold}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: recommendedGold - currentGoldPct > 0 ? "#059669" : recommendedGold - currentGoldPct < 0 ? "#dc2626" : "#475569" }}>
                    {recommendedGold - currentGoldPct > 0 ? `+${recommendedGold - currentGoldPct}` : recommendedGold - currentGoldPct}%
                  </td>
                </tr>
                <tr>
                  <td>Liquid / Emergency Cash</td>
                  <td style={{ textAlign: "right" }}>{currentCashPct}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{recommendedCash}%</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: recommendedCash - currentCashPct > 0 ? "#059669" : recommendedCash - currentCashPct < 0 ? "#dc2626" : "#475569" }}>
                    {recommendedCash - currentCashPct > 0 ? `+${recommendedCash - currentCashPct}` : recommendedCash - currentCashPct}%
                  </td>
                </tr>
                {currentOthersPct > 0 && (
                  <tr>
                    <td>Real Estate & Others</td>
                    <td style={{ textAlign: "right" }}>{currentOthersPct}%</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>0%</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#dc2626" }}>
                      -{currentOthersPct}%
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <div className="fp-h2">Action Items & Recommendations</div>
            <div style={{ marginTop: 6, fontSize: 10, display: "flex", flexDirection: "column", gap: "6px" }}>
              {recommendations.slice(0, 6).map((r, i) => (
                <div key={i} style={{ borderLeft: `2.5px solid ${accent}`, paddingLeft: "6px", lineHeight: "1.3" }}>
                  <strong style={{ textTransform: "capitalize", fontSize: "8px", color: "#475569" }}>
                    [{r.category}] · {r.priority} Priority:
                  </strong>
                  <div style={{ fontWeight: 600 }}>{r.action}</div>
                </div>
              ))}
              {recommendations.length === 0 && (
                <div style={{ fontStyle: "italic", color: "#64748b" }}>No recommendations listed.</div>
              )}
            </div>
          </div>
        </div>

        {/* Notes Remarks */}
        {p.notes && (
          <div className="fp-section">
            <div className="fp-h2">Additional Planner remarks & Assumptions</div>
            <p style={{ fontSize: 10, color: "#334155", lineHeight: 1.5, marginTop: 4, whiteSpace: "pre-line" }}>
              {p.notes}
            </p>
          </div>
        )}

        {/* Signatures */}
        <div
          className="fp-section"
          style={{
            marginTop: 36,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 40,
            alignItems: "end",
          }}
        >
          <div>
            <div style={{ borderBottom: "1px solid #94a3b8", height: 26, marginBottom: 4 }} />
            <div style={{ fontSize: 10, fontWeight: 700 }}>{preparedBy?.name ?? "Wealth Adviser"}</div>
            <div className="fp-muted" style={{ fontSize: 9 }}>
              {(preparedBy as any)?.euin ? `EUIN ${(preparedBy as any).euin}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="fp-muted" style={{ fontSize: 9 }}>Client Authorization & Consent Signature</div>
            <div style={{ borderBottom: "1px solid #94a3b8", height: 26, marginTop: 16 }} />
          </div>
        </div>

        {/* Footer Disclaimers */}
        <div
          className="fp-muted"
          style={{
            marginTop: 28,
            paddingTop: 10,
            borderTop: "1px solid #e2e8f0",
            fontSize: 8,
            lineHeight: "1.4",
          }}
        >
          <div>
            <strong>Disclaimer:</strong> Financial planning recommendations are illustrative and based on client inputs. Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing. Past performance does not guarantee future results.
          </div>
          <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between" }}>
            <span>{tenant?.displayName} · ARN-{(tenant?.arn ?? "").replace(/^ARN-?/i, "")}</span>
            <span>Plan {p.planNumber}</span>
          </div>
        </div>
      </div>
    </>
  );
}
