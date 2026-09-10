"use client";

/**
 * Early-Start Child SIP — invest a monthly SIP into a child's name for the early
 * years, then stop and let the corpus compound to milestone ages. Shows the
 * "start at birth" wealth story (faithful to the Child SIP worksheet, plus a
 * growth chart, the multiple-on-invested and configurable return / horizon).
 *
 * Math: @/lib/calculators/child-sip.
 */

import { useMemo, useState } from "react";
import { inr, NumberField, Field, Section, Stat, Table, Insight } from "./ui";
import { LinesChart, inrShort } from "./charts";
import { computeChildSip } from "@/lib/calculators/child-sip";

export function EarlyStartChildSip() {
  const [startAge, setStartAge] = useState(0);
  const [monthlySip, setMonthlySip] = useState(25000);
  const [investTillAge, setInvestTillAge] = useState(20);
  const [returnPct, setReturnPct] = useState(12);
  const [projectToAge, setProjectToAge] = useState(50);

  const res = useMemo(
    () => computeChildSip({ startAge, monthlySip, investTillAge, returnPct, projectToAge }),
    [startAge, monthlySip, investTillAge, returnPct, projectToAge]
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Early-Start Child SIP</h2>
        <p className="text-xs text-muted-foreground">
          Invest a monthly SIP into a child&apos;s name through the early years, then stop and let the corpus compound. See
          what a limited-period SIP becomes decades later — the power of starting at birth.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <NumberField label="Child's current age" value={startAge} setValue={setStartAge} step={1} />
        <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />
        <NumberField label="Invest till age" value={investTillAge} setValue={setInvestTillAge} step={1} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <NumberField label="Project to age" value={projectToAge} setValue={setProjectToAge} step={5} />
      </div>

      <Section n={1} title="The headline">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label={`Invested (${res.investYears}y of SIP)`} value={inr(res.totalInvested)} />
          <Stat label={`Corpus at age ${investTillAge}`} value={inr(res.corpusAtTill)} tone="cyan" />
          <Stat label={`Value at age ${res.finalAge}`} value={inr(res.finalValue)} tone="emerald" />
          <Stat label={`Multiple on invested`} value={`${res.finalMultiple.toFixed(1)}×`} tone="emerald" />
        </div>
        <Insight tone="emerald">
          A {inr(monthlySip)}/month SIP from age {startAge} to {investTillAge} ({inr(res.totalInvested)} invested over{" "}
          {res.investYears} years), left to compound at {returnPct}%, grows to{" "}
          <strong>{inr(res.finalValue)}</strong> by age {res.finalAge} — about <strong>{res.finalMultiple.toFixed(1)}×</strong>{" "}
          the amount invested, without adding a rupee after age {investTillAge}.
        </Insight>
      </Section>

      <Section n={2} title="Value at each milestone age">
        <Table
          head={["Age", "Corpus value", "× of invested"]}
          rows={res.milestones.map((m) => [
            `Age ${m.age}${m.age === investTillAge ? " (SIP ends)" : ""}`,
            inr(m.value),
            `${m.multiple.toFixed(1)}×`,
          ])}
          highlightLastRow
        />
      </Section>

      <Section n={3} title={`Corpus growth — age ${startAge} to ${res.finalAge}`}>
        <LinesChart
          ariaLabel="Child SIP corpus growth by age"
          height={200}
          xLabels={res.series.map((p) => `Age ${p.age}`)}
          fmtY={(v) => inrShort(v)}
          lines={[{ label: "Corpus", color: "#841F21", values: res.series.map((p) => p.value) }]}
        />
      </Section>

      <p className="text-[10px] text-muted-foreground border-t pt-3">
        * Illustration only. The SIP accumulates at the assumed return (compounded monthly, contributions at month start);
        after the investing period the corpus compounds annually at the same return. Returns are not guaranteed and vary with
        markets. Not investment advice — mutual fund investments are subject to market risks.
      </p>
    </div>
  );
}
