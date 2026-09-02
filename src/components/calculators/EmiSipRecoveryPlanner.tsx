"use client";

/**
 * Recover Your EMIs through SIP (EMI ↔ SIP planner).
 *
 * Sizes a parallel SIP that grows to the total amount a client will repay on a
 * loan over its tenure — so the SIP "recovers" every rupee of EMI. Works from
 * loan details (computes the EMI) or directly from the EMI.
 *
 * Math lives in @/lib/calculators/emi-sip (calibrated to the reference case
 * study to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { SelectField } from "@/components/ui/SelectField";
import { computeEmiSip, type EmiSipMode } from "@/lib/calculators/emi-sip";

export function EmiSipRecoveryPlanner() {
  const [mode, setMode] = useState<EmiSipMode>("loan");
  const [addClientName, setAddClientName] = useState(false);
  const [clientName, setClientName] = useState("");
  const [addSchemes, setAddSchemes] = useState(false);
  const [schemes, setSchemes] = useState("");

  const [loanAmount, setLoanAmount] = useState(2500000);
  const [interestRatePct, setInterestRatePct] = useState(9);
  const [emiAmount, setEmiAmount] = useState(25357);
  const [sipReturnPct, setSipReturnPct] = useState(12);

  const [tenureUnit, setTenureUnit] = useState<"years" | "months">("years");
  const [tenureValue, setTenureValue] = useState(15);
  const tenureMonths = tenureUnit === "years" ? tenureValue * 12 : tenureValue;

  const result = useMemo(
    () => computeEmiSip({ mode, loanAmount, interestRatePct, emiAmount, tenureMonths, sipReturnPct }),
    [mode, loanAmount, interestRatePct, emiAmount, tenureMonths, sipReturnPct]
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Recover Your EMIs through SIP{addClientName && clientName ? ` · ${clientName}` : ""}</h2>
        <p className="text-xs text-muted-foreground">
          Run a SIP alongside the loan EMI so that, by the end of the tenure, it grows to everything you&apos;ll have repaid —
          turning a liability into a wealth habit.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
        <button type="button" onClick={() => setMode("loan")} className={`text-xs px-3 py-1.5 rounded-md ${mode === "loan" ? "bg-white shadow-sm font-semibold" : "text-slate-600"}`}>Enter loan details</button>
        <button type="button" onClick={() => setMode("emi")} className={`text-xs px-3 py-1.5 rounded-md ${mode === "emi" ? "bg-white shadow-sm font-semibold" : "text-slate-600"}`}>Enter EMI details</button>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
        {mode === "loan" ? (
          <>
            <Num label="Outstanding loan amount (₹)" value={loanAmount} setValue={setLoanAmount} />
            <Num label="Rate of interest (% p.a.)" value={interestRatePct} setValue={setInterestRatePct} step={0.25} />
          </>
        ) : (
          <Num label="Monthly EMI (₹)" value={emiAmount} setValue={setEmiAmount} />
        )}
        <Field label={mode === "loan" ? "Loan tenure remaining" : "EMI tenure remaining"}>
          <div className="flex gap-2">
            <input
              type="number"
              value={tenureValue}
              min={0}
              step={1}
              onChange={(e) => setTenureValue(Math.max(0, Number(e.target.value) || 0))}
              className="input-base text-sm w-full"
            />
            <SelectField value={tenureUnit} onChange={(e) => setTenureUnit(e.target.value as "years" | "months")} className="w-28">
              <option value="years">Years</option>
              <option value="months">Months</option>
            </SelectField>
          </div>
        </Field>
        <Num label="Assumed return on SIP (% p.a.)" value={sipReturnPct} setValue={setSipReturnPct} step={0.5} />
      </div>

      {/* Optional client + schemes */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={addClientName} onChange={(e) => setAddClientName(e.target.checked)} /> Add client name
          </label>
          {addClientName && <div className="mt-1 w-56"><ClientNameField value={clientName} onChange={setClientName} /></div>}
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={addSchemes} onChange={(e) => setAddSchemes(e.target.checked)} /> Add suggested schemes for investment
          </label>
          {addSchemes && (
            <textarea value={schemes} onChange={(e) => setSchemes(e.target.value)} rows={2} placeholder="e.g. ABC Flexi Cap, XYZ Large & Midcap" className="input-base text-sm w-full mt-1" />
          )}
        </div>
      </div>

      {/* EMI breakdown (loan mode) */}
      {mode === "loan" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Monthly EMI" value={inr(result.monthlyEmi)} tone="amber" />
          <Stat label="Principal repayment" value={inr(result.principalRepayment ?? 0)} />
          <Stat label="Interest repayment" value={inr(result.interestRepayment ?? 0)} tone="rose" />
          <Stat label="Total repayment" value={inr(result.totalRepayment)} tone="amber" />
        </div>
      )}

      {/* Headline result */}
      <ResultRow
        cells={[
          { label: `Monthly SIP required @ ${sipReturnPct.toFixed(2)}%`, value: inr(result.monthlySipRequired), tone: "emerald" },
          { label: "SIP as % of EMI", value: `${result.sipAsPctOfEmi.toFixed(2)}%`, tone: "emerald" },
          { label: "Total you'll repay", value: inr(result.totalRepayment) },
          { label: "SIP grows to (recovers)", value: inr(result.totalRepayment), tone: "emerald" },
        ]}
      />

      <div className="rounded-lg px-4 py-3 text-sm border border-emerald-200 bg-emerald-50/60 text-emerald-900">
        If you start a SIP of <strong>{inr(result.monthlySipRequired)}</strong> — just{" "}
        <strong>{result.sipAsPctOfEmi.toFixed(2)}%</strong> of your {inr(result.monthlyEmi)} EMI — you&apos;ll accumulate{" "}
        <strong>{inr(result.totalRepayment)}</strong> by the end of the tenure and effectively <strong>recover your entire EMI outgo</strong>.
      </div>

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. Interest on the loan is assumed compounded monthly with the EMI at month end; the SIP earns the
        assumed return monthly. Mutual fund returns are not guaranteed and subject to market risk. Not investment advice.
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  const t = tone === "amber" ? "border-amber-200 bg-amber-50/50" : tone === "rose" ? "border-rose-200 bg-rose-50/50" : "border-slate-200";
  return (
    <div className={`border rounded-md p-3 ${t}`}>
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
