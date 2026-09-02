"use client";

/**
 * Income Bridge Planner (SIP → SWP).
 *
 * Two-phase retirement reckoner: accumulate a corpus (stepped-up SIP / lumpsum /
 * salary-based), then draw an inflation-rising monthly income (SWP) from it until
 * a chosen age, leaving a target end balance behind.
 *
 * Works in two directions:
 *   • "How much income?"   — solve the sustainable monthly SWP from a plan.
 *   • "How much to invest?" — back out the SIP / lumpsum needed for a target SWP.
 *
 * Math lives in @/lib/calculators/income-bridge (calibrated to the reference
 * reckoner to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeIncomeBridge,
  type CalcType,
  type InvestMode,
  type PlanningType,
} from "@/lib/calculators/income-bridge";

const CALC_TYPES: { value: CalcType; label: string }[] = [
  { value: "monthly_swp", label: "How much monthly income?" },
  { value: "investment_need", label: "How much to invest?" },
];

const INVEST_MODES: { value: InvestMode; label: string }[] = [
  { value: "sip", label: "SIP" },
  { value: "lumpsum", label: "Lumpsum" },
  { value: "lumpsum_sip", label: "Lumpsum + SIP" },
  { value: "salary", label: "Salary %" },
];

const PLANNING_TYPES: { value: PlanningType; label: string }[] = [
  { value: "retirement", label: "Retirement Planning" },
  { value: "invest_now_withdraw_later", label: "Invest Now, Withdraw Later" },
];

export function IncomeBridgePlanner() {
  const [clientName, setClientName] = useState("");
  const [objective, setObjective] = useState("");

  const [calcType, setCalcType] = useState<CalcType>("monthly_swp");
  const [investMode, setInvestMode] = useState<InvestMode>("sip");
  const [planningType, setPlanningType] = useState<PlanningType>("retirement");

  // Accumulation
  const [startAge, setStartAge] = useState(35);
  const [sipTillAge, setSipTillAge] = useState(40);
  const [retirementAge, setRetirementAge] = useState(50);
  const [monthlySip, setMonthlySip] = useState(25000);
  const [topUpPct, setTopUpPct] = useState(5);
  const [lumpsum, setLumpsum] = useState(1000000);
  const [monthlySalary, setMonthlySalary] = useState(150000);
  const [savingsPct, setSavingsPct] = useState(20);
  const [salaryGrowthPct, setSalaryGrowthPct] = useState(8);
  const [accumReturnPct, setAccumReturnPct] = useState(12);

  // Distribution
  const [swpTillAge, setSwpTillAge] = useState(90);
  const [distReturnPct, setDistReturnPct] = useState(7);
  const [distInflationPct, setDistInflationPct] = useState(5);
  const [endBalance, setEndBalance] = useState(0);
  const [desiredMonthlySwp, setDesiredMonthlySwp] = useState(50000);

  const usesSip = investMode === "sip" || investMode === "lumpsum_sip";
  const usesLump = investMode === "lumpsum" || investMode === "lumpsum_sip";
  const isSalary = investMode === "salary";
  const isReverse = calcType === "investment_need";

  const result = useMemo(
    () =>
      computeIncomeBridge({
        calcType,
        investMode,
        planningType,
        startAge,
        sipTillAge,
        retirementAge,
        swpTillAge,
        monthlySip,
        topUpPct,
        lumpsum,
        monthlySalary,
        savingsPct,
        salaryGrowthPct,
        accumReturnPct,
        distReturnPct,
        distInflationPct,
        endBalance,
        desiredMonthlySwp,
      }),
    [
      calcType, investMode, planningType, startAge, sipTillAge, retirementAge, swpTillAge,
      monthlySip, topUpPct, lumpsum, monthlySalary, savingsPct, salaryGrowthPct,
      accumReturnPct, distReturnPct, distInflationPct, endBalance, desiredMonthlySwp,
    ]
  );

  return (
    <div className="card-surface p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Income Bridge Planner · SIP → SWP</h2>
        <p className="text-xs text-muted-foreground">
          Build a corpus with a SIP / lumpsum, then draw an inflation-adjusted monthly income (SWP) from it — and see exactly
          how much income it gives, or how much you must invest for the income you want.
        </p>
      </div>

      {/* Step 1 — what to calculate */}
      <div className="grid md:grid-cols-3 gap-3">
        <Segmented label="I want to find" value={calcType} onChange={(v) => setCalcType(v as CalcType)} options={CALC_TYPES} />
        <Segmented label="Build my corpus with" value={investMode} onChange={(v) => setInvestMode(v as InvestMode)} options={INVEST_MODES} />
        <Segmented label="Planning type" value={planningType} onChange={(v) => setPlanningType(v as PlanningType)} options={PLANNING_TYPES} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Objective">
          <input value={objective} onChange={(e) => setObjective(e.target.value)} className="input-base text-sm w-full" placeholder="e.g. Retirement income" />
        </Field>
      </div>

      {/* Inputs — two phases */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Accumulation */}
        <section className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-primary">
            ① Accumulation — build the corpus
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Investment start age" value={startAge} setValue={setStartAge} step={1} />
            {(usesSip || isSalary) && <Num label="SIP till age" value={sipTillAge} setValue={setSipTillAge} step={1} />}
            <Num label="Retirement age" value={retirementAge} setValue={setRetirementAge} step={1} />
            <Num label="Return — accumulation (% p.a.)" value={accumReturnPct} setValue={setAccumReturnPct} step={0.5} />

            {isSalary ? (
              <>
                <Num label="Monthly salary (₹)" value={monthlySalary} setValue={setMonthlySalary} />
                <Num label="Save / invest (% of salary)" value={savingsPct} setValue={setSavingsPct} step={1} />
                <Num label="Annual salary growth (%)" value={salaryGrowthPct} setValue={setSalaryGrowthPct} step={1} />
              </>
            ) : (
              <>
                {usesSip && !isReverse && <Num label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} />}
                {usesSip && <Num label="SIP top-up every year (%)" value={topUpPct} setValue={setTopUpPct} step={1} />}
                {usesLump && <Num label="Lumpsum today (₹)" value={lumpsum} setValue={setLumpsum} />}
              </>
            )}
          </div>
          {isReverse && (
            <p className="text-[10px] text-muted-foreground">
              In “How much to invest?” mode the {investMode === "lumpsum" ? "lumpsum" : "monthly SIP"} is calculated for you — see the result below.
            </p>
          )}
        </section>

        {/* Distribution */}
        <section className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
            ② Distribution — draw the income
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Num label="SWP till age" value={swpTillAge} setValue={setSwpTillAge} step={1} />
            <Num label="Return — distribution (% p.a.)" value={distReturnPct} setValue={setDistReturnPct} step={0.5} />
            <Num label="Inflation — distribution (%)" value={distInflationPct} setValue={setDistInflationPct} step={0.5} />
            {isReverse && <Num label="Desired monthly SWP (₹)" value={desiredMonthlySwp} setValue={setDesiredMonthlySwp} />}
            <div className="col-span-2">
              <Num label="Balance to leave at end of SWP (₹)" value={endBalance} setValue={setEndBalance} />
              {!isReverse && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Max — {inr(result.maxEndBalance)} (if you withdraw nothing). Leave ₹0 to spend it all down.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      {result.warning && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">⚠️ {result.warning}</div>
      )}

      {/* Headline results */}
      {isReverse ? (
        <ResultRow
          cells={[
            { label: "Corpus you’ll need at retirement", value: inr(result.requiredCorpus ?? result.corpus), tone: "amber" },
            investMode === "lumpsum"
              ? { label: "Lumpsum to invest today", value: inr(result.requiredLumpsum ?? 0), tone: "emerald" }
              : { label: isSalary ? "Monthly investment needed" : "Monthly SIP needed", value: inr(result.requiredMonthlySip ?? 0), tone: "emerald" },
            { label: "Your monthly income (SWP)", value: inr(result.monthlySwp) },
            { label: "Total income over SWP period", value: inr(result.totalWithdrawn), tone: "emerald" },
          ]}
        />
      ) : (
        <ResultRow
          cells={[
            { label: "Total accumulated corpus", value: inr(result.corpus), tone: "amber" },
            { label: "Monthly income (SWP)", value: inr(result.monthlySwp), tone: "emerald" },
            { label: "Total income over SWP period", value: inr(result.totalWithdrawn), tone: "emerald" },
            { label: "Balance left at end", value: inr(result.endBalanceActual) },
          ]}
        />
      )}

      {/* Secondary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total invested" value={inr(result.totalInvested)} />
        <Stat label="Wealth gained (accumulation)" value={inr(result.wealthGain)} />
        <Stat label="First → last monthly SWP" value={`${inr(result.monthlySwp)} → ${inr(result.lastMonthlySwp)}`} />
        <Stat
          label="Phases"
          value={`${result.sipYears + result.holdYears}y build · ${result.distYears}y draw`}
        />
        {isSalary && isReverse && result.requiredSavingsPct != null && (
          <Stat label="Required savings rate" value={`${result.requiredSavingsPct.toFixed(1)}% of salary`} />
        )}
      </div>

      {/* Year-by-year SWP schedule */}
      {result.schedule.length > 0 && (
        <details className="border border-slate-200 rounded-lg overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100">
            Year-by-year withdrawal schedule ({result.schedule.length} years)
          </summary>
          <div className="max-h-72 overflow-y-auto scrollbar-thin print:max-h-none print:overflow-visible">
            <table data-pdf="table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Age</th>
                  <th className="px-4 py-2 font-medium text-right">Monthly SWP</th>
                  <th className="px-4 py-2 font-medium text-right">Withdrawn that year</th>
                  <th className="px-4 py-2 font-medium text-right">Corpus at year end</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr key={row.age} className="border-b border-slate-100">
                    <td className="px-4 py-1.5">{row.age}</td>
                    <td className="px-4 py-1.5 text-right">{inr(row.monthlyWithdrawalThatYear)}</td>
                    <td className="px-4 py-1.5 text-right">{inr(row.withdrawnThisYear)}</td>
                    <td className={`px-4 py-1.5 text-right font-medium ${row.endCorpus < 0 ? "text-rose-600" : ""}`}>
                      {inr(row.endCorpus)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. Figures assume constant returns and inflation; actual results vary with market performance.
        SWP grows with inflation each month. Not investment advice.
      </p>
    </div>
  );
}

/* ───────────────────────── bits ───────────────────────── */

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`text-xs px-2.5 py-1.5 rounded-md transition-colors flex-1 min-w-fit ${
              value === o.value ? "bg-white shadow-sm font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

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
