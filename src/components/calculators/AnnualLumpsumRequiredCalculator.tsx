"use client";

/**
 * Annual Lumpsum Required for Target Future Value — how much to invest as a
 * lumpsum each year to reach a goal, across up to two return scenarios.
 * Math: src/lib/calculators/annual-lumpsum-required.ts (verified to the rupee →
 * ₹25L / 10y / 12% needs ₹1,27,197/yr).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeAnnualLumpsumRequired } from "@/lib/calculators/annual-lumpsum-required";
import { inr, fmtPct, NumberField, Field, Stat, Table, Insight, Section } from "./ui";
import { CalcChart } from "./CalcChart";

export function AnnualLumpsumRequiredCalculator() {
  const [clientName, setClientName] = useState("");
  const [targetAmount, setTargetAmount] = useState(2500000);
  const [investmentYears, setInvestmentYears] = useState(10);
  const [paymentYears, setPaymentYears] = useState(10);
  const [scenario1Pct, setScenario1Pct] = useState(12);
  const [useScenario2, setUseScenario2] = useState(false);
  const [scenario2Pct, setScenario2Pct] = useState(10);

  const result = useMemo(
    () =>
      computeAnnualLumpsumRequired({
        targetAmount, investmentYears, paymentYears,
        scenario1Pct, scenario2Pct: useScenario2 ? scenario2Pct : null,
      }),
    [targetAmount, investmentYears, paymentYears, scenario1Pct, useScenario2, scenario2Pct]
  );

  const s1 = result.scenario1;
  const s2 = result.scenario2;
  const deferred = paymentYears < investmentYears;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Annual Lumpsum for Target Future Value</h2>
        <p className="text-xs text-muted-foreground">
          How much to invest as a lumpsum each year to reach a goal — compare the
          yearly amount needed across return scenarios. You can stop paying before
          the horizon ends and let the corpus keep growing.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Target amount (₹)" value={targetAmount} setValue={setTargetAmount} step={100000} />
        <NumberField label="Investment period (yrs)" value={investmentYears} setValue={setInvestmentYears} step={1} />
        <NumberField label="Payment period (yrs)" value={paymentYears} setValue={setPaymentYears} step={1} />
        <NumberField label="Scenario 1 return (%)" value={scenario1Pct} setValue={setScenario1Pct} step={0.5} />
        <div className="flex flex-col justify-end gap-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={useScenario2} onChange={(e) => setUseScenario2(e.target.checked)} className="size-4 rounded border-border accent-primary" />
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Compare scenario 2</span>
          </label>
          {useScenario2 && <NumberField label="Scenario 2 return (%)" value={scenario2Pct} setValue={setScenario2Pct} step={0.5} />}
        </div>
      </div>

      {clientName && (
        <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span> · target {inr(targetAmount)} in {investmentYears} years</div>
      )}

      {/* Required amount(s) */}
      <div className={`grid gap-3 ${s2 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"}`}>
        <Stat label={`Required / yr @ ${fmtPct(s1.ratePct)}`} value={inr(s1.requiredAnnual)} tone="cyan" />
        <Stat label={`Total invested @ ${fmtPct(s1.ratePct)}`} value={inr(s1.totalInvested)} />
        {s2 ? (
          <>
            <Stat label={`Required / yr @ ${fmtPct(s2.ratePct)}`} value={inr(s2.requiredAnnual)} tone="emerald" />
            <Stat label={`Total invested @ ${fmtPct(s2.ratePct)}`} value={inr(s2.totalInvested)} />
          </>
        ) : (
          <Stat label="Wealth gain" value={inr(s1.wealthGain)} tone="emerald" />
        )}
      </div>

      <Insight tone="cyan">
        To reach <strong>{inr(targetAmount)}</strong> in {investmentYears} years
        {deferred ? ` (investing for the first ${paymentYears})` : ""} at {fmtPct(s1.ratePct)}, invest about{" "}
        <strong>{inr(s1.requiredAnnual)}/year</strong>.
        {s2 && <> At {fmtPct(s2.ratePct)} the requirement {s2.requiredAnnual < s1.requiredAnnual ? "drops" : "rises"} to <strong>{inr(s2.requiredAnnual)}/year</strong>.</>}
      </Insight>

      {/* Accumulation schedule (scenario 1) */}
      <Section n={1} title={`Accumulation schedule @ ${fmtPct(s1.ratePct)}`}>
        <CalcChart
          data={s1.schedule.map((r) => ({ year: r.year, value: r.yearEndValue }))}
          xKey="year"
          series={[{ key: "value", name: "Corpus", color: "#0ea5e9" }]}
        />
        <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
          <Table
            head={["Year", "Investment", "Corpus at year-end"]}
            rows={s1.schedule.map((r) => [
              `${r.year}`,
              r.investment > 0 ? inr(r.investment) : "—",
              inr(r.yearEndValue),
            ])}
            highlightLastRow
          />
        </div>
      </Section>
    </div>
  );
}
