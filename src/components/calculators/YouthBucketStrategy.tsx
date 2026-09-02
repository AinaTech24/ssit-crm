"use client";

/**
 * 4-Bucket Strategy — Youth Financial Freedom (EFP workbook). Splits the
 * post-freedom income need across 4 funds (Debt/Hybrid/Large-Cap/Mid-Cap), each
 * funding a 10-year window, and shows the "MFD Alpha": a far smaller corpus and
 * SIP than parking everything in a single debt fund.
 * Math: src/lib/calculators/bucket-strategy.ts → youthBucketStrategy.
 */

import { useMemo, useState } from "react";
import { youthBucketStrategy } from "@/lib/calculators/bucket-strategy";
import { inr, NumberField, Field, Stat, Table, Insight } from "./ui";
import { inrShort } from "./charts";

const BUCKET_COLORS = ["#0891b2", "#f59e0b", "#10b981", "#8b5cf6"];

export function YouthBucketStrategy() {
  const [clientName, setClientName] = useState("");
  const [expense, setExpense] = useState(80000);
  const [ageNow, setAgeNow] = useState(25);
  const [freedomAge, setFreedomAge] = useState(41);
  const [longevity, setLongevity] = useState(90);
  const [inflation, setInflation] = useState(6);
  const [debt, setDebt] = useState(8);
  const [hybrid, setHybrid] = useState(10);
  const [largeCap, setLargeCap] = useState(12);
  const [midCap, setMidCap] = useState(15);

  const res = useMemo(
    () =>
      youthBucketStrategy({
        monthlyExpenseToday: expense,
        inflationPct: inflation,
        ageNow,
        freedomAge,
        longevity,
        debtReturnPct: debt,
        hybridReturnPct: hybrid,
        largeCapReturnPct: largeCap,
        midCapReturnPct: midCap,
      }),
    [expense, inflation, ageNow, freedomAge, longevity, debt, hybrid, largeCap, midCap],
  );

  const activeBuckets = res.buckets.filter((b) => b.pvAtFreedom > 0);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">4-Bucket Strategy — Financial Freedom</h2>
        <p className="text-xs text-muted-foreground">
          Fund a lifetime of freedom across four buckets of rising return — and see how much smaller the corpus and SIP become
          versus a single safe fund.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Client name">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Monthly expense today (₹)" value={expense} setValue={setExpense} step={5000} />
        <NumberField label="Age now" value={ageNow} setValue={setAgeNow} step={1} />
        <NumberField label="Freedom age" value={freedomAge} setValue={setFreedomAge} step={1} />
        <NumberField label="Live until (age)" value={longevity} setValue={setLongevity} step={1} />
        <NumberField label="Inflation (% p.a.)" value={inflation} setValue={setInflation} step={0.5} />
        <NumberField label="Bucket 1 · Debt (% p.a.)" value={debt} setValue={setDebt} step={0.5} />
        <NumberField label="Bucket 2 · Hybrid (% p.a.)" value={hybrid} setValue={setHybrid} step={0.5} />
        <NumberField label="Bucket 3 · Large Cap (% p.a.)" value={largeCap} setValue={setLargeCap} step={0.5} />
        <NumberField label="Bucket 4 · Mid Cap (% p.a.)" value={midCap} setValue={setMidCap} step={0.5} />
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
          SIP with the 4-bucket strategy
        </div>
        <div className="text-3xl font-extrabold text-emerald-700 mt-1">{inr(Math.round(res.sipBucket))}/mo</div>
        <div className="text-xs text-muted-foreground mt-1">
          {(res.savingsPct * 100).toFixed(0)}% lower than the {inr(Math.round(res.sipWithout))}/mo a single debt fund would need —
          freedom at {freedomAge} for {clientName || "your client"}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Corpus — bucket strategy" value={inrShort(res.corpusBucket)} tone="emerald" />
        <Stat label="Corpus — single fund" value={inrShort(res.corpusWithout)} tone="amber" />
        <Stat label="SIP — bucket strategy" value={`${inr(Math.round(res.sipBucket))}/mo`} tone="emerald" />
        <Stat label="SIP — single fund" value={`${inr(Math.round(res.sipWithout))}/mo`} tone="rose" />
      </div>

      {/* Allocation across buckets */}
      {activeBuckets.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
            Corpus split at freedom (age {freedomAge})
          </div>
          <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
            {activeBuckets.map((b, i) => {
              const pct = res.corpusBucket > 0 ? (b.pvAtFreedom / res.corpusBucket) * 100 : 0;
              return (
                <div
                  key={i}
                  className="h-full flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ width: `${Math.max(4, pct)}%`, background: BUCKET_COLORS[res.buckets.indexOf(b)] }}
                  title={`${b.name}: ${pct.toFixed(0)}%`}
                >
                  {pct.toFixed(0)}%
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Table
        head={["Bucket", "Return", "Funds ages", "Expense then / mo", "Corpus at freedom"]}
        rows={activeBuckets.map((b) => [
          b.name,
          `${b.returnPct}%`,
          `${b.startAge}–${b.endAge}`,
          inr(Math.round(b.expenseAtStart)),
          inrShort(b.pvAtFreedom),
        ])}
        highlightCol={4}
      />

      <Insight tone="emerald">
        Funding {res.totalFreedomYears} years of freedom from one debt fund needs <strong>{inrShort(res.corpusWithout)}</strong>; the
        4-bucket strategy needs only <strong>{inrShort(res.corpusBucket)}</strong> ({(res.corpusSavedPct * 100).toFixed(0)}% less) — so
        the SIP drops from {inr(Math.round(res.sipWithout))} to <strong>{inr(Math.round(res.sipBucket))}/month</strong>. That gap is
        the advisor&rsquo;s alpha: each bucket sits in a higher-return fund until it&rsquo;s needed.
      </Insight>

      <Insight tone="amber">
        Illustration only — returns are market-linked and not guaranteed. The plan assumes each bucket stays invested at its assumed
        return until drawn and is reviewed/rebalanced periodically.
      </Insight>
    </div>
  );
}
