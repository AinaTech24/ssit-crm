"use client";

/**
 * Wealth Doubling (Rule of 72) — playful: how fast money doubles at a given
 * return, with the 2×/4×/8×/16× milestones on a timeline. Math: advisory.ts → doublingTimeline.
 */

import { useMemo, useState } from "react";
import { doublingTimeline } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Table, Insight } from "./ui";
import { inrShort } from "./charts";

export function WealthDoublingCalculator() {
  const thisYear = useMemo(() => new Date().getFullYear(), []);
  const [clientName, setClientName] = useState("");
  const [amount, setAmount] = useState(1000000);
  const [returnPct, setReturnPct] = useState(12);
  const [doublings, setDoublings] = useState(4);

  const res = useMemo(
    () => doublingTimeline({ amount, returnPct, doublings }),
    [amount, returnPct, doublings],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Wealth Doubling — Rule of 72</h2>
        <p className="text-xs text-muted-foreground">
          How fast does money double? The simple rule every investor should know — and the milestones it unlocks.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Amount (₹)" value={amount} setValue={setAmount} step={100000} />
        <NumberField label="Expected return (% p.a.)" value={returnPct} setValue={setReturnPct} step={0.5} />
        <NumberField label="How many doublings" value={doublings} setValue={setDoublings} step={1} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Money doubles every" value={Number.isFinite(res.yearsToDouble) ? `${res.yearsToDouble.toFixed(1)} yrs` : "—"} tone="emerald" />
        <Stat label="Rule of 72 estimate" value={Number.isFinite(res.rule72) ? `${res.rule72.toFixed(1)} yrs` : "—"} tone="cyan" />
      </div>

      <Table
        head={["Milestone", "Corpus", "Years", "Reached by"]}
        rows={res.rows.map((r) => [
          `${r.multiple}×`,
          inrShort(r.value),
          Number.isFinite(r.years) ? `${r.years.toFixed(1)} yrs` : "—",
          Number.isFinite(r.years) ? String(thisYear + Math.round(r.years)) : "—",
        ])}
        highlightCol={1}
      />

      <Insight tone="emerald">
        At {returnPct}% p.a., {clientName || "your client"}&rsquo;s {inrShort(amount)} doubles in about{" "}
        <strong>{res.yearsToDouble.toFixed(1)} years</strong> — the &ldquo;Rule of 72&rdquo; (72 ÷ {returnPct}) gives a quick{" "}
        {res.rule72.toFixed(1)}. Stay invested long enough for a few doublings and compounding does the heavy lifting:{" "}
        {inrShort(amount)} becomes <strong>{inrShort(res.rows[res.rows.length - 1].value)}</strong> in{" "}
        {Number.isFinite(res.rows[res.rows.length - 1].years) ? res.rows[res.rows.length - 1].years.toFixed(0) : "—"} years.
      </Insight>
    </div>
  );
}
