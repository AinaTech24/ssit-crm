"use client";

/**
 * Future Value of Annual Lumpsum.
 *
 * A fixed amount invested at the start of each year for the payment period,
 * compounding over the (longer) investment period — with an optional second
 * return scenario to compare. Shows the year-by-year build-up and final value.
 *
 * Math lives in @/lib/calculators/fv-annual-lumpsum (calibrated to the reference
 * case study to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeFvAnnualLumpsum } from "@/lib/calculators/fv-annual-lumpsum";

export function FvAnnualLumpsumPlanner() {
  const [clientName, setClientName] = useState("");

  const [annualInvestment, setAnnualInvestment] = useState(500000);
  const [investmentYears, setInvestmentYears] = useState(15);
  const [paymentYears, setPaymentYears] = useState(10);
  const [scenario1Pct, setScenario1Pct] = useState(12);
  const [scenario2Pct, setScenario2Pct] = useState(0); // 0 = off

  const result = useMemo(
    () =>
      computeFvAnnualLumpsum({
        annualInvestment,
        investmentYears,
        paymentYears,
        scenario1Pct,
        scenario2Pct: scenario2Pct > 0 ? scenario2Pct : null,
      }),
    [annualInvestment, investmentYears, paymentYears, scenario1Pct, scenario2Pct]
  );

  const s1 = result.scenario1;
  const s2 = result.scenario2;
  const paymentExceeds = paymentYears > investmentYears;

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Future Value of Annual Lumpsum</h2>
        <p className="text-xs text-muted-foreground">
          Estimate the future value of a fixed amount invested every year — invest for the payment period, then let it keep
          compounding to the end of the investment period. Compare two return scenarios.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Num label="Annual lumpsum investment (₹)" value={annualInvestment} setValue={setAnnualInvestment} />
        <Field label="Investment period (years)">
          <input type="number" value={investmentYears} min={0} step={1} onChange={(e) => setInvestmentYears(Math.max(0, Number(e.target.value) || 0))} className="input-base text-sm w-full" />
        </Field>
        <Field label="Payment period (years)">
          <input type="number" value={paymentYears} min={0} step={1} onChange={(e) => setPaymentYears(Math.max(0, Number(e.target.value) || 0))} className="input-base text-sm w-full" />
          <span className="text-[10px] text-muted-foreground">Years you actually invest. After this, the corpus just keeps growing.</span>
        </Field>
        <Num label="Scenario 1 return (% p.a.)" value={scenario1Pct} setValue={setScenario1Pct} step={0.5} />
        <Num label="Scenario 2 return (% p.a., optional)" value={scenario2Pct} setValue={setScenario2Pct} step={0.5} />
      </div>

      {paymentExceeds && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Payment period is longer than the investment period — contributions are capped at the investment period ({investmentYears} years).
        </div>
      )}

      {/* Results */}
      <ResultRow
        cells={[
          { label: "Total invested", value: inr(s1.totalInvested) },
          { label: `Future value @ ${s1.ratePct.toFixed(2)}%`, value: inr(s1.futureValue), tone: "emerald" },
          { label: "Wealth gain", value: inr(s1.wealthGain), tone: "emerald" },
          ...(s2
            ? [{ label: `Future value @ ${s2.ratePct.toFixed(2)}%`, value: inr(s2.futureValue), tone: "amber" as const }]
            : []),
        ]}
      />

      {s2 && (
        <div className="text-[11px] text-muted-foreground">
          Difference between scenarios: <strong>{inr(Math.abs(s2.futureValue - s1.futureValue))}</strong>{" "}
          ({s2.ratePct > s1.ratePct ? "Scenario 2 higher" : "Scenario 1 higher"}).
        </div>
      )}

      {/* Schedule */}
      {s1.schedule.length > 0 && (
        <details className="border border-slate-200 rounded-lg overflow-hidden" open>
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100">
            Projected annual investment value ({s1.schedule.length} years)
          </summary>
          <div className="max-h-80 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
            <table data-pdf="table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 font-medium text-right">Annual investment</th>
                  <th className="px-3 py-2 font-medium text-right">Year-end @ {s1.ratePct.toFixed(2)}%</th>
                  {s2 && <th className="px-3 py-2 font-medium text-right">Year-end @ {s2.ratePct.toFixed(2)}%</th>}
                </tr>
              </thead>
              <tbody>
                {s1.schedule.map((row, i) => (
                  <tr key={row.year} className={`border-b border-slate-100 ${row.investment === 0 ? "bg-slate-50/40" : ""}`}>
                    <td className="px-3 py-1.5">{row.year}</td>
                    <td className="px-3 py-1.5 text-right">{row.investment > 0 ? inr(row.investment) : "—"}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{inr(row.yearEndValue)}</td>
                    {s2 && <td className="px-3 py-1.5 text-right">{inr(s2.schedule[i]?.yearEndValue ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. Each year&apos;s investment is assumed made at the start of the year and compounded annually at the
        assumed return. Figures are approximate; returns are neither indicative nor guaranteed. Not investment advice.
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
