"use client";

/**
 * SWP Periodic Withdrawal Planner.
 *
 * Invest (lumpsum / annual lumpsum / SIP / lumpsum + SIP), optionally defer, then
 * draw a fixed amount at periodic intervals while the rest keeps compounding.
 * Shows the year-by-year fund value and the end value.
 *
 * Math lives in @/lib/calculators/swp-periodic (calibrated to the reference
 * case study to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeSwpPeriodic, type SwpInvestMode } from "@/lib/calculators/swp-periodic";

const MODES: { value: SwpInvestMode; label: string }[] = [
  { value: "lumpsum", label: "Lumpsum" },
  { value: "annual_lumpsum", label: "Annual Lumpsum" },
  { value: "sip", label: "SIP" },
  { value: "lumpsum_sip", label: "Lumpsum + SIP" },
];

export function SwpPeriodicPlanner() {
  const [clientName, setClientName] = useState("");
  const [customHeaderOn, setCustomHeaderOn] = useState(false);
  const [customHeader, setCustomHeader] = useState("");
  const [currentAge, setCurrentAge] = useState(40);

  const [investMode, setInvestMode] = useState<SwpInvestMode>("sip");
  const [initialInvestment, setInitialInvestment] = useState(1000000);
  const [monthlySip, setMonthlySip] = useState(10000);
  const [sipYears, setSipYears] = useState(20);
  const [annualAmount, setAnnualAmount] = useState(120000);
  const [annualYears, setAnnualYears] = useState(20);

  const [alloc, setAlloc] = useState({ debt: 0, hybrid: 0, equity: 100 });
  const [returns, setReturns] = useState({ debt: 7, hybrid: 9, equity: 12 });

  const [defermentRequired, setDefermentRequired] = useState(false);
  const [distributionReturnPct, setDistributionReturnPct] = useState(8);
  const [defermentPeriodYears, setDefermentPeriodYears] = useState(5);

  const [withdrawalIntervalYears, setWithdrawalIntervalYears] = useState(2);
  const [numInstallments, setNumInstallments] = useState(10);
  const [eachWithdrawalAmount, setEachWithdrawalAmount] = useState(100000);

  const usesLump = investMode === "lumpsum" || investMode === "lumpsum_sip";
  const usesSip = investMode === "sip" || investMode === "lumpsum_sip";
  const usesAnnual = investMode === "annual_lumpsum";

  const result = useMemo(
    () =>
      computeSwpPeriodic({
        customHeader, currentAge, investMode, initialInvestment, monthlySip, sipYears,
        annualAmount, annualYears, allocation: alloc, returns,
        defermentRequired, distributionReturnPct, defermentPeriodYears,
        withdrawalIntervalYears, numInstallments, eachWithdrawalAmount,
      }),
    [
      customHeader, currentAge, investMode, initialInvestment, monthlySip, sipYears, annualAmount, annualYears,
      alloc, returns, defermentRequired, distributionReturnPct, defermentPeriodYears,
      withdrawalIntervalYears, numInstallments, eachWithdrawalAmount,
    ]
  );

  const allocTotal = alloc.debt + alloc.hybrid + alloc.equity;

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{customHeaderOn && customHeader ? customHeader : "SWP Periodic Withdrawal Planner"}</h2>
        <p className="text-xs text-muted-foreground">
          Invest a lumpsum or SIP, let it grow (optionally for a deferment period), then withdraw a fixed amount at periodic
          intervals while the rest keeps compounding. See the year-by-year fund value and the end value.
        </p>
      </div>

      {/* Header + client */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Num label="Current age (optional)" value={currentAge} setValue={setCurrentAge} step={1} />
        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer mt-5">
            <input type="checkbox" checked={customHeaderOn} onChange={(e) => setCustomHeaderOn(e.target.checked)} /> Custom calculator header
          </label>
        </div>
      </div>
      {customHeaderOn && (
        <Field label="Custom header text">
          <input value={customHeader} onChange={(e) => setCustomHeader(e.target.value)} className="input-base text-sm w-full" placeholder="e.g. Mr. A — Vacation & Retirement Plan" />
        </Field>
      )}

      {/* Investment mode */}
      <div>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">Investment mode</span>
        <div className="flex flex-wrap gap-3">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" checked={investMode === m.value} onChange={() => setInvestMode(m.value)} /> {m.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {usesLump && <Num label="Initial investment (₹)" value={initialInvestment} setValue={setInitialInvestment} />}
        {usesSip && <Num label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} />}
        {usesSip && <Num label="SIP period (years)" value={sipYears} setValue={setSipYears} step={1} />}
        {usesAnnual && <Num label="Annual investment (₹)" value={annualAmount} setValue={setAnnualAmount} />}
        {usesAnnual && <Num label="Invest for (years)" value={annualYears} setValue={setAnnualYears} step={1} />}
      </div>

      {/* Asset allocation + returns */}
      <div className="grid md:grid-cols-2 gap-4">
        <section className="border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-primary">Asset allocation</div>
            <div className={`text-[11px] font-semibold ${allocTotal === 100 ? "text-emerald-600" : "text-rose-600"}`}>Total {allocTotal}%</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Num label="Debt %" value={alloc.debt} setValue={(v) => setAlloc((a) => ({ ...a, debt: v }))} step={5} />
            <Num label="Hybrid %" value={alloc.hybrid} setValue={(v) => setAlloc((a) => ({ ...a, hybrid: v }))} step={5} />
            <Num label="Equity %" value={alloc.equity} setValue={(v) => setAlloc((a) => ({ ...a, equity: v }))} step={5} />
          </div>
        </section>
        <section className="border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">Assumed return per class</div>
            <div className="text-[11px] font-semibold text-emerald-700">Avg {result.averageReturnPct.toFixed(2)}%</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Num label="Debt %" value={returns.debt} setValue={(v) => setReturns((r) => ({ ...r, debt: v }))} step={0.5} />
            <Num label="Hybrid %" value={returns.hybrid} setValue={(v) => setReturns((r) => ({ ...r, hybrid: v }))} step={0.5} />
            <Num label="Equity %" value={returns.equity} setValue={(v) => setReturns((r) => ({ ...r, equity: v }))} step={0.5} />
          </div>
        </section>
      </div>

      {/* Deferment + withdrawal config */}
      <div className="grid md:grid-cols-2 gap-4">
        <section className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Deferment required?</span>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" checked={!defermentRequired} onChange={() => setDefermentRequired(false)} /> No</label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" checked={defermentRequired} onChange={() => setDefermentRequired(true)} /> Yes</label>
          </div>
          {defermentRequired && (
            <div className="grid grid-cols-2 gap-3">
              <Num label="Deferment period (years)" value={defermentPeriodYears} setValue={setDefermentPeriodYears} step={1} />
              <Num label="Return during distribution (%)" value={distributionReturnPct} setValue={setDistributionReturnPct} step={0.5} />
            </div>
          )}
        </section>
        <section className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-700">Periodic withdrawals</div>
          <div className="grid grid-cols-3 gap-3">
            <Num label="Every N years" value={withdrawalIntervalYears} setValue={setWithdrawalIntervalYears} step={1} />
            <Num label="No. of installments" value={numInstallments} setValue={setNumInstallments} step={1} />
            <Num label="Each withdrawal (₹)" value={eachWithdrawalAmount} setValue={setEachWithdrawalAmount} />
          </div>
        </section>
      </div>

      {/* Results */}
      <ResultRow
        cells={[
          { label: `Each withdrawal (every ${withdrawalIntervalYears}y)`, value: inr(eachWithdrawalAmount), tone: "amber" },
          { label: "Total periodic withdrawal", value: inr(result.totalPeriodicWithdrawal), tone: "amber" },
          { label: "Total invested", value: inr(result.totalInvested) },
          { label: "End value", value: inr(result.endValue), tone: result.corpusDepleted ? "rose" : "emerald" },
        ]}
      />

      {result.corpusDepleted && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          ⚠️ The corpus runs out before all withdrawals are made. Reduce the withdrawal amount, lower the number of installments, or invest more.
        </div>
      )}

      {/* Schedule */}
      {result.schedule.length > 0 && (
        <details className="border border-slate-200 rounded-lg overflow-hidden" open>
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100">
            Projected periodic withdrawal &amp; fund value ({result.schedule.length} years)
          </summary>
          <div className="max-h-80 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
            <table data-pdf="table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{currentAge > 0 ? "Age" : "Year"}</th>
                  <th className="px-3 py-2 font-medium text-right">Annual investment</th>
                  <th className="px-3 py-2 font-medium text-right">Withdrawal</th>
                  <th className="px-3 py-2 font-medium text-right">Fund value (year end)</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr key={row.year} className={`border-b border-slate-100 ${row.withdrawalAmount > 0 ? "bg-amber-50/40" : ""}`}>
                    <td className="px-3 py-1.5">{row.age ?? row.year}</td>
                    <td className="px-3 py-1.5 text-right">{row.annualInvestment > 0 ? inr(row.annualInvestment) : "—"}</td>
                    <td className="px-3 py-1.5 text-right">{row.withdrawalAmount > 0 ? inr(row.withdrawalAmount) : inr(0)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{inr(row.fundValueEndOfYear)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only, on the assumptions you enter. The year&apos;s SIP earns its year-end value at the assumed return;
        withdrawals are taken at year end. Actual results vary with market performance. Not investment advice.
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
