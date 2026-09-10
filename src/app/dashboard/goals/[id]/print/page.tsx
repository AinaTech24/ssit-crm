/**
 * Print-optimized goal report — for client sharing.
 *
 *   ?view=summary   → single A4 page snapshot
 *   ?view=detailed  → multi-page report with sensitivity + year-by-year + formulas
 *
 * Server-loads everything, then a small client component triggers
 * `window.print()` once after mount. The user picks "Save as PDF" in the
 * print dialog, attaches it to WhatsApp / email — same UX as a real PDF
 * export but no server-side PDF library required.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { goals, investors, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { FirmLogo } from "@/components/common/FirmLogo";
import {
  computeGoal,
  monthsBetween,
  projectYearly,
  sensitivitySipRates,
  categoryLabel,
} from "@/lib/goal-planning/calc";
import { formatINR } from "@/lib/utils";
import { GoalPrintHelper } from "@/components/goal-planning/GoalPrintHelper";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  not_started: { label: "Not Started", tone: "bg-gray-100 text-gray-700" },
  on_track: { label: "On Track", tone: "bg-emerald-50 text-emerald-700" },
  behind_track: { label: "Behind Track", tone: "bg-amber-50 text-amber-700" },
  achieved: { label: "Achieved ✓", tone: "bg-blue-50 text-blue-700" },
};

export default async function GoalPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: "summary" | "detailed" }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view: "summary" | "detailed" = sp.view === "detailed" ? "detailed" : "summary";
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const g = (await tx.select().from(goals).where(eq(goals.id, id)).limit(1))[0];
    if (!g) return null;
    const inv = (await tx.select().from(investors).where(eq(investors.id, g.investorId)).limit(1))[0];
    const t = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
    return { goal: g, investor: inv, tenant: t };
  });
  if (!data) notFound();

  const goal = data.goal;
  const targetDate = new Date(goal.targetDate);
  const monthsLeft = monthsBetween(new Date(), targetDate);
  const targetAmount = Number(goal.targetAmount);
  const currentValue = Number(goal.currentValue ?? 0);
  const existingSip = Number(goal.existingMonthlySip ?? goal.monthlyContribution ?? 0);
  const ret = Number(goal.expectedReturn ?? 12);

  const calc = computeGoal({
    futureTarget: targetAmount,
    currentValue,
    existingMonthlySip: existingSip,
    monthsLeft,
    expectedReturnPct: ret,
    inflationPct: goal.inflationPct ? Number(goal.inflationPct) : 6,
    stepUpPct: goal.stepUpPct ? Number(goal.stepUpPct) : 10,
  });

  const sensitivity = sensitivitySipRates(targetAmount, currentValue, monthsLeft);
  const projection = projectYearly({
    currentValue,
    initialMonthlySip: calc.requiredMonthlySipTotal,
    annualReturnPct: ret,
    months: monthsLeft,
  });
  const maxCorpus = projection.reduce((mx, r) => Math.max(mx, r.endOfYearCorpus), 0);
  const status = STATUS_COPY[calc.status] ?? STATUS_COPY.not_started;

  return (
    <div className="bg-white text-slate-900 print:bg-white">
      <GoalPrintHelper
        goalId={id}
        view={view}
        investorName={data.investor?.name ?? "Investor"}
      />

      <div className="max-w-3xl mx-auto px-8 py-10 print:py-6 print:px-6">
        {/* Letterhead — the logo is the brand identity (no firm-name text); ARN kept */}
        <div className="flex items-start justify-between pb-4">
          <div className="flex items-center gap-3">
            <FirmLogo
              src={data.tenant?.logoUrl}
              name={data.tenant?.displayName ?? data.tenant?.legalName}
              color={data.tenant?.primaryColor ?? "#841f21"}
              size={48}
              radius={6}
              maxWidth={200}
            />
            <div>
              <div className="text-[11px] text-slate-600">ARN {String(data.tenant?.arn ?? "—").replace(/^ARN-?/i, "")}</div>
              {data.tenant?.email && (
                <div className="text-[11px] text-slate-600">{data.tenant.email}</div>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-slate-600">
            <div className="font-semibold uppercase tracking-wide">Goal Plan</div>
            <div>Prepared {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
          </div>
        </div>
        {/* Theme gradient rule (matches the statement PDF) */}
        <div
          className="h-[5px] rounded-full"
          style={{ background: `linear-gradient(to right, ${data.tenant?.primaryColor ?? "#841f21"}, ${(data.tenant as any)?.secondaryColor ?? "#d22e32"})` }}
        />

        {/* Salutation */}
        <div className="mt-5 text-sm">
          <div className="text-slate-700">Dear {data.investor?.name ?? "Investor"},</div>
          <p className="mt-2 text-slate-700 leading-relaxed">
            This report summarises your <strong>{goal.name}</strong> goal and the contribution plan
            needed to achieve it. Numbers are based on the assumptions stated at the bottom.
          </p>
        </div>

        {/* Goal headline */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Goal</div>
            <div className="font-semibold mt-1">{goal.name}</div>
            <div className="text-xs text-slate-600 mt-0.5">{categoryLabel(goal.category)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Status</div>
            <div className={`text-xs font-semibold inline-block px-2 py-0.5 rounded-full mt-1 ${status.tone}`}>
              {status.label}
            </div>
            <div className="text-xs text-slate-600 mt-1">
              {monthsLeft} months to {targetDate.getFullYear()}
            </div>
          </div>
        </div>

        {/* Money grid */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Money label="Target amount" value={formatINR(targetAmount)} />
          <Money label="Current investment" value={formatINR(currentValue)} />
          <Money label="Existing monthly SIP" value={formatINR(existingSip)} />
        </div>

        {/* Three ways — always included */}
        <h2 className="text-base font-bold mt-8 mb-3 tracking-tight">Three ways to reach this goal</h2>
        <div className="grid grid-cols-3 gap-3">
          <Plan
            label="Option A · Flat monthly SIP"
            value={formatINR(Math.round(calc.requiredMonthlySipTotal))}
            sub="Same amount every month"
          />
          <Plan
            label="Option B · Step-up SIP (start)"
            value={formatINR(Math.round(calc.requiredStepUpInitialSip))}
            sub={`Increases ${calc.stepUpPct} % every year`}
          />
          <Plan
            label="Option C · Lumpsum today"
            value={formatINR(Math.round(calc.requiredLumpsumToday))}
            sub="One-time, no further SIP"
          />
        </div>

        {/* Gap / extra-SIP callouts */}
        {(calc.additionalMonthlySipNeeded > 0 || calc.gapAmount > 0) && (
          <div className="mt-3 space-y-2">
            {calc.additionalMonthlySipNeeded > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm flex items-center justify-between">
                <span>Additional SIP needed beyond existing ₹{existingSip.toLocaleString("en-IN")}/mo</span>
                <span className="font-bold tabular-nums">
                  {formatINR(Math.round(calc.additionalMonthlySipNeeded))}/mo
                </span>
              </div>
            )}
            {calc.gapAmount > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm flex items-center justify-between">
                <span>Gap at goal date if nothing changes</span>
                <span className="font-bold tabular-nums">{formatINR(Math.round(calc.gapAmount))}</span>
              </div>
            )}
          </div>
        )}

        {/* ─── Detailed view only ─── */}
        {view === "detailed" && (
          <>
            {/* Sensitivity */}
            <h2 className="text-base font-bold mt-8 mb-3 tracking-tight">
              Sensitivity — SIP needed at different return rates
            </h2>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Return p.a.</th>
                  <th className="text-right px-3 py-2 font-semibold">Flat SIP needed</th>
                  <th className="text-right px-3 py-2 font-semibold">Lumpsum-today alternative</th>
                </tr>
              </thead>
              <tbody>
                {sensitivity.map((s) => (
                  <tr
                    key={s.ratePct}
                    className={`border-t border-slate-200 ${
                      Math.abs(s.ratePct - ret) < 0.01 ? "bg-cyan-50 font-semibold" : ""
                    }`}
                  >
                    <td className="px-3 py-2">{s.ratePct} %</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatINR(Math.round(s.sip))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {formatINR(Math.round(s.lumpsum))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Year-by-year */}
            <h2 className="text-base font-bold mt-8 mb-3 tracking-tight">Year-by-year projection</h2>
            <p className="text-xs text-slate-600 mb-2">
              Assumes current investment of {formatINR(currentValue)} + new SIP of{" "}
              {formatINR(Math.round(calc.requiredMonthlySipTotal))}/mo, both compounding at {ret} % p.a.
            </p>

            <div className="flex items-end gap-1 h-24 mb-2 border-b border-slate-300 pb-1">
              {projection.map((row) => {
                const h = maxCorpus > 0 ? (row.endOfYearCorpus / maxCorpus) * 100 : 0;
                const filled = row.endOfYearCorpus / targetAmount;
                const bg =
                  filled >= 1 ? "bg-emerald-500" : filled >= 0.5 ? "bg-cyan-500" : "bg-slate-700";
                return (
                  <div key={row.year} className="flex-1" style={{ minWidth: "3px" }}>
                    <div className={`${bg} rounded-t`} style={{ height: `${h}%`, minHeight: "2px" }} />
                  </div>
                );
              })}
            </div>

            <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-1.5 font-semibold">Year</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Contributed</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Cumulative</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Corpus EoY</th>
                  <th className="text-right px-3 py-1.5 font-semibold">% to target</th>
                </tr>
              </thead>
              <tbody>
                {projection.map((row) => {
                  const pct = (row.endOfYearCorpus / targetAmount) * 100;
                  return (
                    <tr key={row.year} className="border-t border-slate-200">
                      <td className="px-3 py-1.5 tabular-nums">{row.year}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {formatINR(Math.round(row.contributedThisYear))}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {formatINR(Math.round(row.cumulativeContributed))}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                        {formatINR(Math.round(row.endOfYearCorpus))}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {pct >= 100 ? <span className="text-emerald-600">{pct.toFixed(0)} %</span> : `${pct.toFixed(0)} %`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Formula appendix */}
            <h2 className="text-base font-bold mt-8 mb-3 tracking-tight">How these numbers are calculated</h2>
            <ul className="text-xs space-y-2 text-slate-700 leading-relaxed">
              <li>
                <strong>Future-value of an SIP:</strong> P × ((1 + r/12)<sup>n</sup> − 1) / (r/12) × (1 + r/12),
                where P = monthly SIP, r = annual return, n = months.
              </li>
              <li>
                <strong>Required SIP:</strong> (Target − FV of current investment) × (r/12) /
                (((1 + r/12)<sup>n</sup> − 1) × (1 + r/12)).
              </li>
              <li>
                <strong>Lumpsum-today:</strong> Target / (1 + r/12)<sup>n</sup>.
              </li>
              <li>
                <strong>Step-up SIP:</strong> Starting amount that, when increased {calc.stepUpPct} % each year,
                reaches the target at the same compounding rate.
              </li>
            </ul>
          </>
        )}

        {/* Disclosure footer */}
        <div className="mt-10 pt-4 border-t border-slate-200 text-[10px] text-slate-500 leading-relaxed">
          <p>
            <strong>Important disclosures:</strong> Mutual fund investments are subject to market risks.
            Read all scheme-related documents carefully. The illustrations above are based on assumed
            returns and inflation; actual results will vary. Past performance is not indicative of future
            results. Please consult your relationship manager before making any investment decision.
          </p>
          <p className="mt-2">
            Prepared by {data.tenant?.displayName ?? "your MFD"} · ARN {data.tenant?.arn ?? "—"} ·
            Generated {new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.
          </p>
        </div>
      </div>
    </div>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function Plan({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-300 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold tabular-nums mt-1">{value}</div>
      <div className="text-[10px] text-slate-600 mt-0.5 leading-tight">{sub}</div>
    </div>
  );
}
