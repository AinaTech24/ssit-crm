"use client";

/**
 * SWP Comprehensive Planner — the full SWP tool: 4 investment modes
 * (lumpsum / annual lumpsum / SIP / lumpsum+SIP), accumulation + deferment,
 * a distribution-phase asset-allocation grid (auto average return), withdrawal
 * frequency, annual increment, and amount/%-of-corpus withdrawal with a
 * max-sustainable prompt. Math: src/lib/calculators/swp-comprehensive.ts.
 */

import { useMemo, useState } from "react";
import { ClientNameField } from "./ClientNameField";
import {
  computeSwpComprehensive, weightedAvg, FREQ_LABEL,
  type InvestMode, type Frequency, type WithdrawalMode, type IncrementMode,
  type Allocation, type Rates,
} from "@/lib/calculators/swp-comprehensive";
import {
  inr, fmtPct, clampNum, NumberField, Field, Toggle, Segmented, Section, Stat, Table, Insight,
} from "./ui";
import { CalcChart } from "./CalcChart";

export function SwpComprehensivePlanner() {
  const [clientName, setClientName] = useState("");
  const [currentAge, setCurrentAge] = useState(60);
  const [investMode, setInvestMode] = useState<InvestMode>("lumpsum");
  const [lumpsum, setLumpsum] = useState(5000000);
  const [monthlySip, setMonthlySip] = useState(25000);
  const [accumulationYears, setAccumulationYears] = useState(15);
  const [accumulationReturnPct, setAccumulationReturnPct] = useState(12);
  const [deferment, setDeferment] = useState(false);
  const [defermentYears, setDefermentYears] = useState(5);

  // Distribution allocation + rates
  const [alloc, setAlloc] = useState<Allocation>({ debtPct: 0, hybridPct: 100, equityPct: 0 });
  const [rates, setRates] = useState<Rates>({ debtPct: 7, hybridPct: 9, equityPct: 12 });

  const [swpYears, setSwpYears] = useState(15);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [withdrawalMode, setWithdrawalMode] = useState<WithdrawalMode>("percentage");
  const [withdrawalAmount, setWithdrawalAmount] = useState(29167);
  const [withdrawalAnnualPct, setWithdrawalAnnualPct] = useState(7);
  const [increment, setIncrement] = useState<IncrementMode>("none");
  const [incrementPct, setIncrementPct] = useState(6);
  const [incrementAmount, setIncrementAmount] = useState(1000);

  const isLumpsum = investMode === "lumpsum";
  const needsSip = investMode === "sip" || investMode === "lumpsum_sip";
  const needsLump = investMode === "lumpsum" || investMode === "annual_lumpsum" || investMode === "lumpsum_sip";
  const needsAccum = investMode !== "lumpsum";

  const allocTotal = alloc.debtPct + alloc.hybridPct + alloc.equityPct;
  const distReturnPct = useMemo(() => weightedAvg(alloc, rates), [alloc, rates]);

  const result = useMemo(
    () =>
      computeSwpComprehensive({
        investMode, lumpsum, monthlySip, accumulationYears, accumulationReturnPct,
        defermentYears: deferment ? defermentYears : 0,
        distReturnPct, swpYears, frequency, withdrawalMode,
        withdrawalAmount, withdrawalAnnualPct, increment, incrementPct, incrementAmount,
      }),
    [investMode, lumpsum, monthlySip, accumulationYears, accumulationReturnPct, deferment, defermentYears, distReturnPct, swpYears, frequency, withdrawalMode, withdrawalAmount, withdrawalAnnualPct, increment, incrementPct, incrementAmount]
  );

  const per = FREQ_LABEL[frequency];

  const depleted = result.depletedAtPeriod != null;
  const tone = depleted ? "rose" : result.finalValue >= result.accumulatedCorpus ? "emerald" : "amber";

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">SWP Comprehensive Planner</h2>
        <p className="text-xs text-muted-foreground">
          How much can you withdraw — monthly, quarterly, half-yearly or annually —
          from a lumpsum, recurring or SIP-built corpus, and what is left at the end.
        </p>
      </div>

      {/* Investment mode + amounts */}
      <Segmented
        label="Investment mode"
        value={investMode}
        onChange={setInvestMode}
        options={[
          { value: "lumpsum", label: "Lumpsum" },
          { value: "annual_lumpsum", label: "Annual Lumpsum" },
          { value: "sip", label: "SIP" },
          { value: "lumpsum_sip", label: "Lumpsum + SIP" },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Current age (optional)" value={currentAge} setValue={setCurrentAge} step={1} />
        {needsLump && (
          <NumberField
            label={investMode === "annual_lumpsum" ? "Annual lumpsum (₹)" : "Lumpsum (₹)"}
            value={lumpsum} setValue={setLumpsum} step={100000}
          />
        )}
        {needsSip && <NumberField label="Monthly SIP (₹)" value={monthlySip} setValue={setMonthlySip} step={1000} />}
        {needsAccum && <NumberField label="Accumulation period (yrs)" value={accumulationYears} setValue={setAccumulationYears} step={1} />}
        {needsAccum && <NumberField label="Return during accumulation (%)" value={accumulationReturnPct} setValue={setAccumulationReturnPct} step={0.5} />}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Toggle checked={deferment} onChange={setDeferment} label="Deferment before SWP?" />
        {deferment && <NumberField label="Deferment period (yrs)" value={defermentYears} setValue={setDefermentYears} step={1} />}
      </div>

      {/* Distribution allocation grid */}
      <div className="rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Distribution phase — asset allocation &amp; returns
        </div>
        <AllocGrid title="Allocation %" total={allocTotal} totalBad={Math.abs(allocTotal - 100) > 0.01}
          values={[alloc.debtPct, alloc.hybridPct, alloc.equityPct]}
          onChange={(i, v) => setAlloc((p) => ({ debtPct: i === 0 ? v : p.debtPct, hybridPct: i === 1 ? v : p.hybridPct, equityPct: i === 2 ? v : p.equityPct }))}
        />
        <AllocGrid title="Assumed return %" total={distReturnPct} totalLabel="Average %"
          values={[rates.debtPct, rates.hybridPct, rates.equityPct]}
          onChange={(i, v) => setRates((p) => ({ debtPct: i === 0 ? v : p.debtPct, hybridPct: i === 1 ? v : p.hybridPct, equityPct: i === 2 ? v : p.equityPct }))}
        />
        {Math.abs(allocTotal - 100) > 0.01 && (
          <p className="text-[11px] text-rose-600">Allocation should total 100% (currently {allocTotal.toFixed(0)}%).</p>
        )}
      </div>

      {/* SWP parameters */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="SWP period (yrs)" value={swpYears} setValue={setSwpYears} step={1} />
      </div>

      <Segmented
        label="Withdrawal frequency"
        value={frequency}
        onChange={setFrequency}
        options={[
          { value: "monthly", label: "Monthly" },
          { value: "quarterly", label: "Quarterly" },
          { value: "halfyearly", label: "Half-yearly" },
          { value: "annually", label: "Annually" },
        ]}
      />

      <div className="rounded-lg border border-border/70 p-4 bg-secondary/20 print:bg-transparent space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            label="Withdrawal option"
            value={withdrawalMode}
            onChange={setWithdrawalMode}
            options={[
              { value: "amount", label: "In amount" },
              { value: "percentage", label: "In % of corpus" },
            ]}
          />
          {withdrawalMode === "amount" ? (
            <NumberField label={`Withdrawal per ${per} (₹)`} value={withdrawalAmount} setValue={setWithdrawalAmount} step={1000} />
          ) : (
            <NumberField label="Total annual withdrawal (%)" value={withdrawalAnnualPct} setValue={setWithdrawalAnnualPct} step={0.5} />
          )}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            label="Annual increment"
            value={increment}
            onChange={setIncrement}
            options={[
              { value: "none", label: "None" },
              { value: "percentage", label: "In %" },
              { value: "amount", label: "In amount" },
            ]}
          />
          {increment === "percentage" && <NumberField label="Increment per year (%)" value={incrementPct} setValue={setIncrementPct} step={0.5} />}
          {increment === "amount" && <NumberField label={`Increment per ${per} per year (₹)`} value={incrementAmount} setValue={setIncrementAmount} step={500} />}
        </div>
      </div>

      {clientName && <div className="text-sm font-medium">Prepared for <span className="text-primary">{clientName}</span></div>}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Corpus at SWP start" value={inr(result.accumulatedCorpus)} tone="cyan" />
        <Stat label={`Withdrawal / ${per}`} value={inr(result.basePerPeriodWithdrawal)} />
        <Stat label={`Max sustainable / ${per}`} value={`${inr(result.maxPerPeriodWithdrawal)}`} tone="emerald" />
        <Stat label={depleted ? "Final value (depleted)" : "Final value"} value={depleted ? "₹0" : inr(result.finalValue)} tone={tone as any} />
      </div>

      <Insight tone={tone as any}>
        {depleted ? (
          <>At {inr(result.basePerPeriodWithdrawal)}/{per}, the corpus runs out before {swpYears} years. The max sustainable withdrawal is about <strong>{inr(result.maxPerPeriodWithdrawal)}/{per}</strong> ({result.maxAnnualPct.toFixed(1)}%/yr).</>
        ) : result.exceedsMax ? (
          <>This withdrawal exceeds the sustainable maximum — reduce it to about <strong>{inr(result.maxPerPeriodWithdrawal)}/{per}</strong> to last the full {swpYears} years.</>
        ) : (
          <>Withdrawing {inr(result.basePerPeriodWithdrawal)}/{per} for {swpYears} years leaves <strong>{inr(result.finalValue)}</strong> at the end. The maximum sustainable withdrawal is about <strong>{inr(result.maxPerPeriodWithdrawal)}/{per}</strong> ({result.maxAnnualPct.toFixed(1)}%/yr).</>
        )}
      </Insight>

      {/* Year-by-year */}
      {result.yearRows.length > 0 && (
        <Section n={1} title="Year-by-year distribution">
          <CalcChart
            data={result.yearRows.map((r) => ({ year: r.year, balance: r.endBalance }))}
            xKey="year"
            series={[{ key: "balance", name: "Corpus balance", color: "#d22e32" }]}
          />
          <div className="max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
            <Table
              head={["Year", `Withdrawal / ${per}`, "Withdrawn that year", "Balance at year-end"]}
              rows={result.yearRows.map((r) => [
                `${r.year}`,
                inr(r.withdrawalPerPeriod),
                inr(r.withdrawnThisYear),
                r.endBalance > 0 ? inr(r.endBalance) : "Exhausted",
              ])}
            />
          </div>
        </Section>
      )}
    </div>
  );
}

/* allocation / rate 3-column grid with an auto total/average cell */
function AllocGrid({
  title, values, onChange, total, totalLabel = "Total %", totalBad,
}: {
  title: string;
  values: [number, number, number] | number[];
  onChange: (i: number, v: number) => void;
  total: number;
  totalLabel?: string;
  totalBad?: boolean;
}) {
  const labels = ["Debt %", "Hybrid %", "Equity %"];
  return (
    <div className="grid grid-cols-4 gap-2 items-end">
      {labels.map((lab, i) => (
        <label key={i} className="block">
          <span className="text-[10px] text-muted-foreground block mb-0.5">{i === 0 ? `${title} — ${lab}` : lab}</span>
          <input
            type="number" value={values[i]} step={0.5} min={0}
            onChange={(e) => onChange(i, clampNum(e.target.value))}
            className="input-base text-sm w-full"
          />
        </label>
      ))}
      <label className="block">
        <span className="text-[10px] text-muted-foreground block mb-0.5">{totalLabel}</span>
        <div className={`input-base text-sm w-full bg-secondary/40 ${totalBad ? "text-rose-600 font-semibold" : ""}`}>
          {total.toFixed(totalLabel.includes("Average") ? 2 : 0)}%
        </div>
      </label>
    </div>
  );
}
