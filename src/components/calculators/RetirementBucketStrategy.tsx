"use client";

/**
 * Retirement Bucket Strategy — the 3-bucket plan (cash / debt / equity) that
 * lets a retiree draw income for life without panic-selling equity in a crash.
 * Math: src/lib/calculators/advisory.ts → retirementBuckets.
 */

import { useMemo, useState } from "react";
import { retirementBuckets } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { inrShort } from "./charts";

export function RetirementBucketStrategy() {
  const [clientName, setClientName] = useState("");
  const [corpus, setCorpus] = useState(50000000);
  const [expense, setExpense] = useState(150000);
  const [b1Years, setB1Years] = useState(3);
  const [b2Years, setB2Years] = useState(7);

  const res = useMemo(
    () => retirementBuckets({ corpus, monthlyExpense: expense, bucket1Years: b1Years, bucket2Years: b2Years }),
    [corpus, expense, b1Years, b2Years],
  );

  const buckets = [
    { name: "Bucket 1 · Cash", sub: `${b1Years} yrs of spending — liquid/arbitrage`, amt: res.b1, pct: res.b1Pct, color: "#0891b2" },
    { name: "Bucket 2 · Debt", sub: `Years ${b1Years + 1}–${res.yearsCovered} — short-term debt`, amt: res.b2, pct: res.b2Pct, color: "#f59e0b" },
    { name: "Bucket 3 · Equity", sub: `Year ${res.yearsCovered + 1}+ — long-term growth`, amt: res.b3, pct: res.b3Pct, color: "#10b981" },
  ];

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Retirement Bucket Strategy</h2>
        <p className="text-xs text-muted-foreground">
          Split the corpus into 3 buckets so the client draws income for life — and never sells equity in a downturn.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Retirement corpus (₹)" value={corpus} setValue={setCorpus} step={500000} />
        <NumberField label="Monthly expense (₹)" value={expense} setValue={setExpense} step={5000} />
        <NumberField label="Bucket 1 — cash (yrs)" value={b1Years} setValue={setB1Years} step={1} />
        <NumberField label="Bucket 2 — debt (yrs)" value={b2Years} setValue={setB2Years} step={1} />
      </div>

      {/* Stacked allocation bar */}
      <div>
        <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
          {buckets.map((b, i) => (
            <div
              key={i}
              className="h-full flex items-center justify-center text-[10px] font-semibold text-white"
              style={{ width: `${Math.max(3, b.pct * 100)}%`, background: b.color }}
              title={b.name}
            >
              {(b.pct * 100).toFixed(0)}%
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {buckets.map((b, i) => (
          <div key={i} className="border rounded-md p-3" style={{ borderColor: `${b.color}55` }}>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: b.color }} />
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{b.name}</div>
            </div>
            <div className="text-lg font-semibold mt-1">{inrShort(b.amt)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{b.sub}</div>
          </div>
        ))}
      </div>

      <Insight tone="emerald">
        On {inrShort(corpus)} with {inr(expense)}/month spending: keep <strong>{inrShort(res.b1)}</strong> in cash (the next {b1Years}
        {" "}years are crash-proof), <strong>{inrShort(res.b2)}</strong> in debt, and let <strong>{inrShort(res.b3)}</strong> compound in
        equity. Refill Bucket 1 from Bucket 2, and Bucket 2 from equity in good years — so {clientName || "the retiree"} never sells
        equity in a downturn.
      </Insight>

      <Insight tone="amber">
        A planning framework, not a guarantee. Review and refill the buckets annually; actual longevity depends on returns, inflation and spending.
      </Insight>
    </div>
  );
}
