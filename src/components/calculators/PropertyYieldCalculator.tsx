"use client";

/**
 * Property Rental Yield & Reinvestment.
 *
 * Evaluates the *true* return on a property: capital appreciation + net rental
 * surplus + the wealth created when that surplus is reinvested as a SIP. The
 * headline is a blended "Overall Yield" that beats looking at rent or
 * appreciation alone.
 *
 * Math lives in @/lib/calculators/property-yield (calibrated to the reference
 * case study to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computePropertyYield } from "@/lib/calculators/property-yield";

export function PropertyYieldCalculator() {
  const [clientName, setClientName] = useState("");

  const [marketValue, setMarketValue] = useState(10000000);
  const [appreciationPct, setAppreciationPct] = useState(5);
  const [monthlyRent, setMonthlyRent] = useState(30000);
  const [monthlyMaintenance, setMonthlyMaintenance] = useState(2500);
  const [annualIncrementPct, setAnnualIncrementPct] = useState(3);
  const [investibleSurplus, setInvestibleSurplus] = useState(27500);
  const [sipReturnPct, setSipReturnPct] = useState(12);
  const [years, setYears] = useState(10);

  const netSurplus = Math.max(0, monthlyRent - monthlyMaintenance);

  const result = useMemo(
    () =>
      computePropertyYield({
        marketValue,
        appreciationPct,
        monthlyRent,
        monthlyMaintenance,
        annualIncrementPct,
        investibleSurplus,
        sipReturnPct,
        years,
      }),
    [marketValue, appreciationPct, monthlyRent, monthlyMaintenance, annualIncrementPct, investibleSurplus, sipReturnPct, years]
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Property Rental Yield &amp; Reinvestment</h2>
        <p className="text-xs text-muted-foreground">
          See the real return on a property — appreciation <em>plus</em> the net rental surplus reinvested as a SIP — and the
          blended yield it produces. The real magic isn&apos;t the rent; it&apos;s what you do with it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Property */}
        <section className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-primary">① The property</div>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Current market value (₹)" value={marketValue} setValue={setMarketValue} />
            <Num label="Expected appreciation (% p.a.)" value={appreciationPct} setValue={setAppreciationPct} step={0.5} />
            <Num label="Current monthly rent (₹)" value={monthlyRent} setValue={setMonthlyRent} />
            <Num label="Monthly maintenance cost (₹)" value={monthlyMaintenance} setValue={setMonthlyMaintenance} />
            <Num label="Annual increment — rent & expenses (%)" value={annualIncrementPct} setValue={setAnnualIncrementPct} step={0.5} />
            <Num label="Report period (years)" value={years} setValue={setYears} step={1} />
          </div>
        </section>

        {/* Reinvestment */}
        <section className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">② Reinvest the surplus</div>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Starting monthly investible surplus (₹)" value={investibleSurplus} setValue={setInvestibleSurplus} />
            <Num label="Assumed return on SIP (% p.a.)" value={sipReturnPct} setValue={setSipReturnPct} step={0.5} />
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>Net surplus = rent − maintenance = <strong>{inr(netSurplus)}</strong>/mo.</span>
            {investibleSurplus !== netSurplus && (
              <button type="button" onClick={() => setInvestibleSurplus(netSurplus)} className="text-primary hover:underline font-medium">
                Use net surplus
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">The reinvested surplus steps up each year by the rent/expense increment, as rent rises.</p>
        </section>
      </div>

      {/* Headline results */}
      <ResultRow
        cells={[
          { label: `Property value after ${years}y`, value: inr(result.futurePropertyValue), tone: "amber" },
          { label: "SIP value from rental surplus", value: inr(result.sipValue), tone: "emerald" },
          { label: "Total combined wealth", value: inr(result.totalCombined), tone: "emerald" },
          { label: "Overall yield", value: `${result.overallYieldPct.toFixed(2)}%`, tone: "emerald" },
        ]}
      />

      {/* Secondary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Appreciation-only return" value={`${result.propertyOnlyCagrPct.toFixed(2)}% p.a.`} />
        <Stat label="Net annual rental yield" value={`${result.annualRentalYieldPct.toFixed(2)}%`} />
        <Stat label="Total surplus reinvested" value={inr(result.totalInvestedSurplus)} />
        <Stat label="Wealth from reinvestment" value={inr(result.sipGain)} />
      </div>

      {/* The "reframe" insight */}
      <div className="text-[11px] bg-emerald-50/60 border border-emerald-200 rounded-md px-3 py-2 text-emerald-900">
        Property alone grows to <strong>{inr(result.futurePropertyValue)}</strong> (~{result.propertyOnlyCagrPct.toFixed(1)}%).
        Reinvesting the rent lifts the blended yield to <strong>{result.overallYieldPct.toFixed(2)}%</strong> — property + disciplined
        reinvestment beats property alone.
      </div>

      {/* Year-by-year schedule */}
      {result.schedule.length > 0 && (
        <details className="border border-slate-200 rounded-lg overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100">
            Year-by-year breakdown ({result.schedule.length} years)
          </summary>
          <div className="max-h-72 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
            <table data-pdf="table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 font-medium text-right">Property value</th>
                  <th className="px-3 py-2 font-medium text-right">Monthly surplus</th>
                  <th className="px-3 py-2 font-medium text-right">SIP corpus</th>
                  <th className="px-3 py-2 font-medium text-right">Combined</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr key={row.year} className="border-b border-slate-100">
                    <td className="px-3 py-1.5">{row.year}</td>
                    <td className="px-3 py-1.5 text-right">{inr(row.propertyValue)}</td>
                    <td className="px-3 py-1.5 text-right">{inr(row.monthlySurplusThatYear)}</td>
                    <td className="px-3 py-1.5 text-right">{inr(row.sipCorpus)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{inr(row.combined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. A fictional scenario for education — figures assume constant appreciation, rent growth and SIP
        return, which vary in reality. Not investment advice; consult scheme documents before investing.
      </p>
    </div>
  );
}

/* ───────────────────────── bits ───────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Num({
  label,
  value,
  setValue,
  step = 1000,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => {
          const n = e.target.value === "" ? 0 : Number(e.target.value);
          setValue(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-md p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function ResultRow({
  cells,
}: {
  cells: Array<{ label: string; value: string; tone?: "emerald" | "amber" | "rose" }>;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c, i) => {
        const tone =
          c.tone === "emerald"
            ? "border-emerald-200 bg-emerald-50/60"
            : c.tone === "amber"
              ? "border-amber-200 bg-amber-50/60"
              : c.tone === "rose"
                ? "border-rose-200 bg-rose-50/60"
                : "";
        return (
          <div key={i} className={`border rounded-md p-3 ${tone}`}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{c.label}</div>
            <div className="text-lg font-semibold mt-0.5">{c.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
