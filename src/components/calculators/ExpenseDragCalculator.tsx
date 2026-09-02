"use client";

/**
 * Expense-Ratio Drag — what a higher expense ratio quietly costs over time
 * (e.g. regular vs direct plan). Math: src/lib/calculators/expense-drag.ts.
 */

import { useMemo, useState } from "react";
import { computeExpenseDrag } from "@/lib/calculators/expense-drag";
import { inr, fmtPct, NumberField, Section, Stat, Table, Insight } from "./ui";
import { CalcChart } from "./CalcChart";

export function ExpenseDragCalculator() {
  const [lumpsum, setLumpsum] = useState(0);
  const [monthlySip, setMonthlySip] = useState(25000);
  const [years, setYears] = useState(20);
  const [grossReturnPct, setGrossReturnPct] = useState(13);
  const [expenseRatioAPct, setExpenseRatioAPct] = useState(1.5);
  const [expenseRatioBPct, setExpenseRatioBPct] = useState(0.6);

  const r = useMemo(
    () => computeExpenseDrag({ lumpsum, monthlySip, years, grossReturnPct, expenseRatioAPct, expenseRatioBPct }),
    [lumpsum, monthlySip, years, grossReturnPct, expenseRatioAPct, expenseRatioBPct]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Expense-Ratio Drag</h2>
        <p className="text-xs text-muted-foreground">
          A small difference in expense ratio compounds into a big difference in
          wealth. See exactly what a costlier fund (or plan) takes from a portfolio
          over time.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Lumpsum (₹)" value={lumpsum} setValue={setLumpsum} step={50000} />
        <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />
        <NumberField label="Years" value={years} setValue={setYears} step={1} />
        <NumberField label="Gross return (%)" value={grossReturnPct} setValue={setGrossReturnPct} step={0.5} />
        <NumberField label="Expense ratio A (%)" value={expenseRatioAPct} setValue={setExpenseRatioAPct} step={0.1} />
        <NumberField label="Expense ratio B (%)" value={expenseRatioBPct} setValue={setExpenseRatioBPct} step={0.1} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`Option A (${fmtPct(expenseRatioAPct)} ER → ${fmtPct(r.netReturnA)})`} value={inr(r.fvA)} tone="rose" />
        <Stat label={`Option B (${fmtPct(expenseRatioBPct)} ER → ${fmtPct(r.netReturnB)})`} value={inr(r.fvB)} tone="emerald" />
        <Stat label="Cost of the higher ER" value={inr(r.drag)} tone="rose" />
        <Stat label="As % of corpus" value={`${r.dragPctOfCorpus.toFixed(1)}%`} />
      </div>

      <Section n={1} title="Wealth gap over time">
        <CalcChart
          data={r.series.map((p) => ({ year: p.year, a: p.a, b: p.b }))}
          xKey="year"
          series={[
            { key: "b", name: `Lower ER (${fmtPct(expenseRatioBPct)})`, color: "#10b981" },
            { key: "a", name: `Higher ER (${fmtPct(expenseRatioAPct)})`, color: "#ef4444" },
          ]}
        />
        <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
          <Table
            head={["Year", `A (${fmtPct(expenseRatioAPct)} ER)`, `B (${fmtPct(expenseRatioBPct)} ER)`, "Gap"]}
            rows={r.series.filter((p) => p.year % Math.max(1, Math.round(years / 20)) === 0 || p.year === years).map((p) => [
              `${p.year}`,
              inr(p.a),
              inr(p.b),
              inr(p.b - p.a),
            ])}
            highlightLastRow
          />
        </div>
      </Section>

      <Insight tone="rose">
        A {fmtPct(expenseRatioAPct - expenseRatioBPct)} higher expense ratio quietly costs{" "}
        <strong>{inr(r.drag)}</strong> over {years} years — about {r.dragPctOfCorpus.toFixed(1)}% of the final corpus,
        on {inr(r.totalInvested)} invested. The same gross return, very different outcomes — which is why fund and plan
        selection (and the advice behind it) matters.
      </Insight>
    </div>
  );
}
