"use client";

/**
 * STP Comprehensive Planner.
 *
 * Future value of a lumpsum routed Debt → Equity via a Systematic Transfer Plan,
 * with Capital-Appreciation or Fixed-Amount transfer modes and any frequency
 * (daily … annually). Shows the year-by-year debt/equity split and the blended
 * annualised return.
 *
 * Math lives in @/lib/calculators/stp-comprehensive (calibrated to the reference
 * case study to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { SelectField } from "@/components/ui/SelectField";
import {
  computeStpComprehensive, STP_FREQUENCIES, type StpFrequency, type StpTransferMode,
} from "@/lib/calculators/stp-comprehensive";

export function StpComprehensivePlanner() {
  const [addClientName, setAddClientName] = useState(false);
  const [clientName, setClientName] = useState("");
  const [addSchemes, setAddSchemes] = useState(false);
  const [schemes, setSchemes] = useState("");

  const [initialInvestment, setInitialInvestment] = useState(2500000);
  const [debtReturnPct, setDebtReturnPct] = useState(5);
  const [equityReturnPct, setEquityReturnPct] = useState(12);
  const [transferMode, setTransferMode] = useState<StpTransferMode>("fixed");
  const [frequency, setFrequency] = useState<StpFrequency>("weekly");
  const [numInstallments, setNumInstallments] = useState(50);
  const [fixedTransferAmount, setFixedTransferAmount] = useState(50000);

  const [periodUnit, setPeriodUnit] = useState<"years" | "months">("years");
  const [periodValue, setPeriodValue] = useState(10);
  const [reportDetail, setReportDetail] = useState(true); // Detail vs Summary

  const totalMonths = periodUnit === "years" ? periodValue * 12 : periodValue;

  const result = useMemo(
    () =>
      computeStpComprehensive({
        initialInvestment, debtReturnPct, equityReturnPct, transferMode, frequency,
        numInstallments, fixedTransferAmount, totalMonths,
      }),
    [initialInvestment, debtReturnPct, equityReturnPct, transferMode, frequency, numInstallments, fixedTransferAmount, totalMonths]
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">STP Comprehensive Planner{addClientName && clientName ? ` · ${clientName}` : ""}</h2>
        <p className="text-xs text-muted-foreground">
          Future value of a lumpsum moved Debt → Equity through a Systematic Transfer Plan — pick the transfer mode, frequency
          and installments, and see the blended annualised return.
        </p>
      </div>

      {/* Core inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Num label="Initial investment (₹)" value={initialInvestment} setValue={setInitialInvestment} />
        <Num label="Debt fund return (% p.a.)" value={debtReturnPct} setValue={setDebtReturnPct} step={0.5} />
        <Num label="Equity fund return (% p.a.)" value={equityReturnPct} setValue={setEquityReturnPct} step={0.5} />
      </div>

      {/* Transfer mode */}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">Transfer mode</span>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" checked={transferMode === "appreciation"} onChange={() => setTransferMode("appreciation")} /> Capital Appreciation
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" checked={transferMode === "fixed"} onChange={() => setTransferMode("fixed")} /> Fixed Amount
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {transferMode === "appreciation"
              ? "Only the debt fund's gains move to equity — the principal stays in debt."
              : "A fixed ₹ amount moves to equity each period, for the chosen number of installments."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Transfer frequency">
            <SelectField value={frequency} onChange={(e) => setFrequency(e.target.value as StpFrequency)} className="w-full">
              {STP_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </SelectField>
          </Field>
          <Num label="No. of installments" value={numInstallments} setValue={setNumInstallments} step={1} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
        {transferMode === "fixed" && <Num label="Each transfer amount (₹)" value={fixedTransferAmount} setValue={setFixedTransferAmount} />}
        <Field label="Total investment period">
          <div className="flex gap-2">
            <input
              type="number"
              value={periodValue}
              min={0}
              step={1}
              onChange={(e) => setPeriodValue(Math.max(0, Number(e.target.value) || 0))}
              className="input-base text-sm w-full"
            />
            <SelectField value={periodUnit} onChange={(e) => setPeriodUnit(e.target.value as "years" | "months")} className="w-28">
              <option value="years">Years</option>
              <option value="months">Months</option>
            </SelectField>
          </div>
        </Field>
        <Field label="Report">
          <SelectField value={reportDetail ? "detail" : "summary"} onChange={(e) => setReportDetail(e.target.value === "detail")} className="w-full">
            <option value="summary">Summary</option>
            <option value="detail">Detail (year-by-year)</option>
          </SelectField>
        </Field>
      </div>

      {/* Optional: client + schemes */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={addClientName} onChange={(e) => setAddClientName(e.target.checked)} /> Add client name
          </label>
          {addClientName && <div className="mt-1 w-56"><ClientNameField value={clientName} onChange={setClientName} /></div>}
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={addSchemes} onChange={(e) => setAddSchemes(e.target.checked)} /> Add suggested schemes
          </label>
          {addSchemes && (
            <textarea
              value={schemes}
              onChange={(e) => setSchemes(e.target.value)}
              rows={2}
              placeholder="e.g. Debt: XYZ Liquid Fund · Equity: ABC Flexi Cap"
              className="input-base text-sm w-full mt-1"
            />
          )}
        </div>
      </div>

      {/* Results */}
      <ResultRow
        cells={[
          { label: "Debt fund value", value: inr(result.debtFinalValue) },
          { label: "Equity fund value", value: inr(result.equityFinalValue), tone: "emerald" },
          { label: "Total fund value", value: inr(result.totalFinalValue), tone: "emerald" },
          { label: "Annualised return", value: `${result.annualisedReturnPct.toFixed(2)}%`, tone: "emerald" },
        ]}
      />
      <div className="text-[11px] text-muted-foreground">
        Total transferred to equity: <strong>{inr(result.totalTransferred)}</strong> over {result.totalPeriods}{" "}
        {STP_FREQUENCIES.find((f) => f.value === frequency)?.label.toLowerCase()} period(s).
      </div>

      {/* Year-by-year (Detail) */}
      {reportDetail && result.schedule.length > 0 && (
        <details className="border border-slate-200 rounded-lg overflow-hidden" open>
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100">
            Projected annual investment value ({result.schedule.length} years)
          </summary>
          <div className="max-h-80 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
            <table data-pdf="table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 font-medium text-right">Debt (begin)</th>
                  <th className="px-3 py-2 font-medium text-right">Transferred</th>
                  <th className="px-3 py-2 font-medium text-right">Equity (end)</th>
                  <th className="px-3 py-2 font-medium text-right">Total (end)</th>
                  <th className="px-3 py-2 font-medium text-right">Annualised</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr key={row.year} className="border-b border-slate-100">
                    <td className="px-3 py-1.5">{row.year}</td>
                    <td className="px-3 py-1.5 text-right">{inr(row.debtBeginning)}</td>
                    <td className="px-3 py-1.5 text-right">{row.transferredToEquity > 0 ? inr(row.transferredToEquity) : "—"}</td>
                    <td className="px-3 py-1.5 text-right">{inr(row.equityEnd)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{inr(row.totalEnd)}</td>
                    <td className="px-3 py-1.5 text-right">{row.annualisedReturnPct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only, on the assumptions you enter. The plan is simulated at the transfer frequency (effective rate);
        actual results vary with market performance. Not investment advice.
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
