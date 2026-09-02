"use client";

/**
 * EMI → SIP Housing — compares the wealth created by three ways of acquiring the
 * same home (pay off early / keep loan & invest / rent & buy late), all funded
 * by the same EMI-equivalent. Math: src/lib/calculators/housing-emi-sip.ts.
 */

import { useMemo, useState } from "react";
import { housingEmiSip } from "@/lib/calculators/housing-emi-sip";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

const STRAT_COLORS: Record<string, string> = { payoff: "#f59e0b", keep: "#0891b2", rentbuy: "#10b981" };

export function HousingEmiSipCalculator() {
  const [clientName, setClientName] = useState("");
  const [loan, setLoan] = useState(25000000);
  const [loanRate, setLoanRate] = useState(9);
  const [tenure, setTenure] = useState(20);
  const [escalation, setEscalation] = useState(6);
  const [sipReturn, setSipReturn] = useState(15);
  const [sipGrowth, setSipGrowth] = useState(10);
  const [rentYield, setRentYield] = useState(4);
  const [rentGrowth, setRentGrowth] = useState(10);

  const res = useMemo(
    () =>
      housingEmiSip({
        loan,
        loanRatePct: loanRate,
        tenureYears: tenure,
        escalationPct: escalation,
        sipReturnPct: sipReturn,
        sipGrowthPct: sipGrowth,
        rentYieldPct: rentYield,
        rentGrowthPct: rentGrowth,
      }),
    [loan, loanRate, tenure, escalation, sipReturn, sipGrowth, rentYield, rentGrowth],
  );

  const best = res.strategies.find((s) => s.key === res.bestKey)!;
  const payoff = res.strategies.find((s) => s.key === "payoff")!;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">EMI → SIP — Home-Buying Wealth Strategy</h2>
        <p className="text-xs text-muted-foreground">
          Same home, same monthly outgo — three ways to fund it. See which builds the most wealth over the loan tenure.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Client name">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-base text-sm w-full" />
        </Field>
        <NumberField label="Home / loan amount (₹)" value={loan} setValue={setLoan} step={500000} />
        <NumberField label="Loan rate (% p.a.)" value={loanRate} setValue={setLoanRate} step={0.1} />
        <NumberField label="Tenure (years)" value={tenure} setValue={setTenure} step={1} />
        <NumberField label="Property escalation (% p.a.)" value={escalation} setValue={setEscalation} step={0.5} />
        <NumberField label="Equity SIP return (% p.a.)" value={sipReturn} setValue={setSipReturn} step={0.5} />
        <NumberField label="SIP step-up (% p.a.)" value={sipGrowth} setValue={setSipGrowth} step={0.5} />
        <NumberField label="Rental yield (%)" value={rentYield} setValue={setRentYield} step={0.5} />
        <NumberField label="Rent growth (% p.a.)" value={rentGrowth} setValue={setRentGrowth} step={0.5} />
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-center text-sm">
        Monthly outgo across all three: <strong>{inr(Math.round(res.emiMonthly))}/mo</strong> (the home-loan EMI)
      </div>

      {/* Three strategy cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {res.strategies.map((s) => {
          const isBest = s.key === res.bestKey;
          return (
            <div
              key={s.key}
              className={`border rounded-lg p-4 ${isBest ? "border-emerald-300 bg-emerald-50/50" : "border-border"}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: STRAT_COLORS[s.key] }} />
                <div className="text-sm font-semibold">{s.label}</div>
                {isBest && <span className="chip text-[9px] bg-emerald-100 text-emerald-700 ml-auto">Best</span>}
              </div>
              <div className="text-2xl font-extrabold mt-2" style={{ color: STRAT_COLORS[s.key] }}>
                {inrShort(s.wealth)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {s.key === "payoff" ? "wealth created" : `${(s.incrementalPct * 100).toFixed(0)}% more than paying off early`}
              </div>
              <div className="text-xs mt-2 pt-2 border-t border-border/60">
                ≈ <strong>{inrShort(s.monthlyIncome)}/mo</strong> income for life
              </div>
              <div className="text-[10px] text-muted-foreground mt-1.5 leading-snug">{s.note}</div>
            </div>
          );
        })}
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={res.strategies.map((s) => ({ label: s.label, value: s.wealth, color: STRAT_COLORS[s.key] }))}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Home cost at end of tenure" value={inrShort(res.houseCostAtEnd)} tone="amber" />
        <Stat label="Total rent paid (rent route)" value={inrShort(res.totalRentPaid)} tone="rose" />
        <Stat label="Loan cleared early in" value={`${res.loanOverYear} yrs`} tone="cyan" />
      </div>

      <Insight tone="emerald">
        On the same {inr(Math.round(res.emiMonthly))}/month, <strong>{best.label.toLowerCase()}</strong> builds the most —{" "}
        <strong>{inrShort(best.wealth)}</strong> ({(best.incrementalPct * 100).toFixed(0)}% more than paying the loan off early),
        worth ~{inrShort(best.monthlyIncome)}/month of income for life. Renting and investing the full EMI in equity keeps the cheap
        9%-ish loan working against a 15% return — and you still buy the house at the end.
      </Insight>

      <Insight tone="amber">
        Illustration only. Equity returns are market-linked and not guaranteed; renting forgoes the security & forced-savings of
        owning, and assumes the EMI-equivalent is invested every month without fail. Tax benefit modelled at 30% of interest (capped
        ₹60k/yr).
      </Insight>
    </div>
  );
}
