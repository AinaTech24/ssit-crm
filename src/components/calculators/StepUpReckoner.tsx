"use client";

/**
 * Step-Up SIP Reckoner — compares Regular vs %-step-up vs ₹-step-up growth from
 * one starting SIP, across several timeframes at once. Renamed from the
 * reference "SIP + Step-Up SIP Ready Reckoner". Math:
 * src/lib/calculators/stepup-reckoner.ts (verified to the rupee).
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import { computeReckoner } from "@/lib/calculators/stepup-reckoner";
import { inr, clampNum, fmtPct, Field, NumberField, Section, Table, Insight } from "./ui";

const MAX_PERIODS = 5;

export function StepUpReckoner() {
  const [monthly, setMonthly] = useState(10000);
  const [ratePct, setRatePct] = useState(12);
  const [periods, setPeriods] = useState<number[]>([10, 15, 20, 25, 30]);
  const [stepUpPct, setStepUpPct] = useState(10);
  const [stepUpAmount, setStepUpAmount] = useState(2000);
  const [clientName, setClientName] = useState("");

  const result = useMemo(
    () => computeReckoner({ monthly, ratePct, periods, stepUpPct, stepUpAmount }),
    [monthly, ratePct, periods, stepUpPct, stepUpAmount]
  );

  function setPeriodAt(i: number, v: number) {
    setPeriods((prev) => prev.map((p, idx) => (idx === i ? v : p)));
  }
  function addPeriod() {
    setPeriods((prev) => (prev.length >= MAX_PERIODS ? prev : [...prev, (prev[prev.length - 1] ?? 0) + 5]));
  }
  function removePeriod(i: number) {
    setPeriods((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  // Column layout for the result tables.
  const strategyCols: Array<{ key: "regular" | "stepPct" | "stepAmt"; label: string }> = [
    { key: "regular", label: "Regular SIP" },
    ...(result.hasStepPct ? [{ key: "stepPct" as const, label: `Step-up ${fmtPct(stepUpPct)}/yr` }] : []),
    ...(result.hasStepAmt ? [{ key: "stepAmt" as const, label: `Step-up ${inr(stepUpAmount)}/yr` }] : []),
  ];

  const corpusRows = result.rows.map((r) => [
    `${r.years} yrs`,
    ...strategyCols.map((c) => (r[c.key] ? inr(r[c.key]!.corpus) : "—")),
  ]);
  const investedRows = result.rows.map((r) => [
    `${r.years} yrs`,
    ...strategyCols.map((c) => (r[c.key] ? inr(r[c.key]!.invested) : "—")),
  ]);

  // Highlight the strongest strategy column (by corpus at the longest tenure).
  const longest = result.rows[result.rows.length - 1];
  let bestKey: "regular" | "stepPct" | "stepAmt" = "regular";
  if (longest) {
    let best = longest.regular.corpus;
    if (longest.stepPct && longest.stepPct.corpus > best) { best = longest.stepPct.corpus; bestKey = "stepPct"; }
    if (longest.stepAmt && longest.stepAmt.corpus > best) { best = longest.stepAmt.corpus; bestKey = "stepAmt"; }
  }
  const bestColIdx = strategyCols.findIndex((c) => c.key === bestKey) + 1; // +1 for the label column

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Step-Up SIP Reckoner</h2>
        <p className="text-xs text-muted-foreground">
          One starting SIP, three growth paths — Regular, a yearly % step-up, and a
          fixed ₹ step-up — projected side by side across several timeframes.
        </p>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Monthly SIP (₹)" value={monthly} setValue={setMonthly} step={500} />
        <NumberField label="Assumed return (% p.a.)" value={ratePct} setValue={setRatePct} step={0.5} />
        <NumberField label="Step-up % every year" value={stepUpPct} setValue={setStepUpPct} step={1} />
        <NumberField label="Step-up amount/yr (₹)" value={stepUpAmount} setValue={setStepUpAmount} step={500} />
      </div>

      {/* Periods */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
          Timeframes to compare (years)
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {periods.map((p, i) => (
            <div key={i} className="flex items-end gap-1">
              <label className="block">
                <span className="text-[10px] text-muted-foreground block mb-0.5">#{i + 1}</span>
                <input
                  type="number"
                  value={p}
                  step={1}
                  min={1}
                  onChange={(e) => setPeriodAt(i, clampNum(e.target.value))}
                  className="input-base text-sm w-20"
                />
              </label>
              {periods.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePeriod(i)}
                  className="text-muted-foreground hover:text-rose-600 text-lg leading-none pb-1.5 print:hidden"
                  aria-label={`Remove timeframe ${i + 1}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {periods.length < MAX_PERIODS && (
            <button type="button" onClick={addPeriod} className="btn-ghost text-xs print:hidden">
              + Add timeframe
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Set step-up % or step-up ₹ to 0 to hide that column.
        </p>
      </div>

      {clientName && (
        <div className="text-sm font-medium">
          Prepared for <span className="text-primary">{clientName}</span>
        </div>
      )}

      {/* Output 1 — future corpus */}
      <Section n={1} title="Projected corpus by strategy">
        <Table
          head={["Timeframe", ...strategyCols.map((c) => c.label)]}
          rows={corpusRows}
          highlightCol={bestColIdx > 0 ? bestColIdx : undefined}
        />
        {(result.hasStepPct || result.hasStepAmt) && (
          <Insight>
            Increasing your SIP every year — even modestly — compounds into far greater wealth than a flat SIP over long horizons.
          </Insight>
        )}
      </Section>

      {/* Output 2 — amount invested */}
      <Section n={2} title="Total amount invested">
        <Table head={["Timeframe", ...strategyCols.map((c) => c.label)]} rows={investedRows} />
        <Insight tone="cyan">
          Step-up strategies invest more over time (rising with income), which is why their corpus pulls ahead.
        </Insight>
      </Section>
    </div>
  );
}
