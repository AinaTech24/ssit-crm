"use client";

/**
 * Loan Prepay vs Invest — the universal dilemma: use surplus cash to prepay the
 * loan, or invest it? Compares net worth on each path at the loan's original
 * end-date. Math: src/lib/calculators/advisory.ts → prepayVsInvest.
 */

import { useMemo, useState } from "react";
import { prepayVsInvest } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

export function PrepayVsInvestCalculator() {
  const [clientName, setClientName] = useState("");
  const [outstanding, setOutstanding] = useState(5000000);
  const [loanRate, setLoanRate] = useState(8.5);
  const [remainingYears, setRemainingYears] = useState(15);
  const [surplus, setSurplus] = useState(20000);
  const [investReturn, setInvestReturn] = useState(12);

  const res = useMemo(
    () =>
      prepayVsInvest({
        outstanding,
        loanRatePct: loanRate,
        remainingMonths: Math.round(remainingYears * 12),
        surplusMonthly: surplus,
        investReturnPct: investReturn,
      }),
    [outstanding, loanRate, remainingYears, surplus, investReturn],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Loan Prepay vs Invest</h2>
        <p className="text-xs text-muted-foreground">
          Got surplus cash? See whether prepaying the loan or investing the difference leaves your client richer.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Loan outstanding (₹)" value={outstanding} setValue={setOutstanding} step={100000} />
        <NumberField label="Loan rate (% p.a.)" value={loanRate} setValue={setLoanRate} step={0.1} />
        <NumberField label="Remaining tenure (yrs)" value={remainingYears} setValue={setRemainingYears} step={1} />
        <NumberField label="Monthly surplus (₹)" value={surplus} setValue={setSurplus} step={5000} />
        <NumberField label="Expected investment return (% p.a.)" value={investReturn} setValue={setInvestReturn} step={0.5} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Loan EMI" value={`${inr(Math.round(res.emi))}/mo`} tone="cyan" />
        <Stat label="Prepay → final corpus" value={inr(Math.round(res.prepayCorpus))} tone={res.winner === "prepay" ? "emerald" : undefined} />
        <Stat label="Invest → final corpus" value={inr(Math.round(res.investCorpus))} tone={res.winner === "invest" ? "emerald" : undefined} />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "Prepay loan", value: res.prepayCorpus, color: res.winner === "prepay" ? "#10b981" : "#94a3b8" },
          { label: "Invest surplus", value: res.investCorpus, color: res.winner === "invest" ? "#10b981" : "#94a3b8" },
        ]}
      />

      <Insight tone="emerald">
        <strong>{res.winner === "invest" ? "Investing the surplus" : "Prepaying the loan"}</strong> wins by{" "}
        <strong>{inrShort(res.gap)}</strong> at the loan&rsquo;s original end-date. Prepaying still saves{" "}
        <strong>{inrShort(res.interestSaved)}</strong> in interest and closes the loan {Math.round(res.monthsSaved / 12)} yr
        {Math.round(res.monthsSaved / 12) === 1 ? "" : "s"} early.
      </Insight>

      <Insight tone="amber">
        Prepaying is a <strong>guaranteed, risk-free</strong> {loanRate}% return and removes debt stress; investing targets a higher{" "}
        <em>but not guaranteed</em> {investReturn}%. The maths favours investing only if returns hold and the client stays the course.
      </Insight>
    </div>
  );
}
