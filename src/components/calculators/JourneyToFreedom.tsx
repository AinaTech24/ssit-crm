"use client";

/**
 * The Journey to Freedom — invest your monthly surplus (salary − expenses) and
 * watch the corpus grow until it can sustain your inflating expenses forever:
 * the year of Financial Freedom. Math: src/lib/calculators/journey-to-freedom.ts.
 */

import { useMemo, useState } from "react";
import { journeyToFreedom } from "@/lib/calculators/journey-to-freedom";
import { inr, NumberField, Field, Stat, Table, Insight } from "./ui";
import { LinesChart, inrShort } from "./charts";

export function JourneyToFreedom() {
  const [clientName, setClientName] = useState("");
  const [salary, setSalary] = useState(50000);
  const [expenses, setExpenses] = useState(30000);
  const [inflation, setInflation] = useState(5);
  const [returnPct, setReturnPct] = useState(12);

  const res = useMemo(
    () =>
      journeyToFreedom({
        salaryMonthly: salary,
        expensesMonthly: expenses,
        inflationPct: inflation,
        returnPct: returnPct,
        maxYears: 30,
      }),
    [salary, expenses, inflation, returnPct],
  );

  const reached = res.freedomYear !== null;
  const freedomFinite = Number.isFinite(res.freedomCorpus);

  // Chart: corpus over years + the freedom threshold line (if finite).
  const xLabels = res.rows.map((r) => `Yr ${r.year}`);
  const lines = [
    { label: "Your corpus", color: "#10b981", values: res.rows.map((r) => r.corpus) },
    ...(freedomFinite
      ? [{ label: "Freedom line", color: "#841f21", values: res.rows.map(() => res.freedomCorpus) }]
      : []),
  ];

  // Table window: up to the freedom year + 1 (or first 12 rows if not reached).
  const tableRows = (reached ? res.rows.slice(0, Math.min(res.rows.length, (res.freedomYear ?? 0) + 1)) : res.rows.slice(0, 12)).map(
    (r) => [
      r.year,
      inrShort(r.corpus),
      r.freedom ? "Forever ✓" : `${r.yearsOfFreedom.toFixed(1)} yrs`,
    ],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">The Journey to Freedom</h2>
        <p className="text-xs text-muted-foreground">
          Invest the gap between income and spending, and watch the corpus grow until it funds your lifestyle forever — the moment of
          Financial Freedom.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Client name">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Monthly income (₹)" value={salary} setValue={setSalary} step={5000} />
        <NumberField label="Monthly expenses (₹)" value={expenses} setValue={setExpenses} step={2500} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <NumberField label="Inflation (% p.a.)" value={inflation} setValue={setInflation} step={0.5} />
      </div>

      {res.investmentMonthly <= 0 ? (
        <Insight tone="rose">
          Expenses meet or exceed income, so there&rsquo;s nothing to invest yet. Trim spending or grow income to begin the journey.
        </Insight>
      ) : reached ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
            {clientName ? `${clientName} reaches` : "You reach"} Financial Freedom in
          </div>
          <div className="text-3xl font-extrabold text-emerald-700 mt-1">{res.freedomYear} years</div>
          <div className="text-xs text-muted-foreground mt-1">
            investing {inr(res.investmentMonthly)}/month — the corpus then funds expenses for life
          </div>
        </div>
      ) : (
        <Insight tone="amber">
          At {inr(res.investmentMonthly)}/month, freedom isn&rsquo;t reached within 30 years. Invest more, cut expenses, or target a
          higher return to bring it forward.
        </Insight>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Investable surplus" value={`${inr(res.investmentMonthly)}/mo`} tone="cyan" />
        <Stat label="Freedom corpus needed" value={freedomFinite ? inrShort(res.freedomCorpus) : "—"} tone="emerald" />
        <Stat
          label="Corpus at freedom"
          value={res.corpusAtFreedom != null ? inrShort(res.corpusAtFreedom) : "—"}
          tone="emerald"
        />
      </div>

      {res.investmentMonthly > 0 && (
        <LinesChart
          ariaLabel="Corpus growth toward the freedom line"
          xLabels={xLabels}
          fmtY={(v) => inrShort(v)}
          lines={lines}
        />
      )}

      {res.investmentMonthly > 0 && (
        <Table head={["Year", "Corpus", "Years of freedom"]} rows={tableRows} highlightLastRow={reached} highlightCol={2} />
      )}

      <Insight tone="emerald">
        Freedom isn&rsquo;t about a magic number — it&rsquo;s the point where your money out-earns your lifestyle. At a real return of{" "}
        <strong>{res.realRatePct.toFixed(1)}%</strong> (return {returnPct}% minus inflation {inflation}%), {clientName || "your client"}
        {" "}gets there by investing the {inr(res.investmentMonthly)}/month gap consistently. Raising the savings rate is the single
        biggest lever.
      </Insight>
    </div>
  );
}
