"use client";

/**
 * Rent vs Buy + Invest the Difference — the great Indian dilemma. Compares the
 * net worth of buying a home (equity = appreciated value − outstanding loan)
 * against renting and investing the down-payment + the monthly EMI-vs-rent gap.
 * Math: src/lib/calculators/conversion.ts → rentVsBuy.
 */

import { useMemo, useState } from "react";
import { rentVsBuy } from "@/lib/calculators/conversion";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { LinesChart, inrShort } from "./charts";

export function RentVsBuyPlanner() {
  const [clientName, setClientName] = useState("");
  const [homePrice, setHomePrice] = useState(10000000);
  const [downPct, setDownPct] = useState(20);
  const [loanRate, setLoanRate] = useState(8.5);
  const [loanYears, setLoanYears] = useState(20);
  const [appreciation, setAppreciation] = useState(7);
  const [maintenance, setMaintenance] = useState(1);
  const [rent, setRent] = useState(30000);
  const [rentInflation, setRentInflation] = useState(7);
  const [equityReturn, setEquityReturn] = useState(12);
  const [horizon, setHorizon] = useState(20);

  const res = useMemo(
    () =>
      rentVsBuy({
        homePrice,
        downPaymentPct: downPct,
        loanRatePct: loanRate,
        loanYears,
        homeAppreciationPct: appreciation,
        maintenancePctPerYear: maintenance,
        monthlyRent: rent,
        rentInflationPct: rentInflation,
        equityReturnPct: equityReturn,
        horizonYears: horizon,
      }),
    [homePrice, downPct, loanRate, loanYears, appreciation, maintenance, rent, rentInflation, equityReturn, horizon],
  );

  const gap = Math.abs(res.buyNetWorth - res.rentNetWorth);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Rent vs Buy — & Invest the Difference</h2>
        <p className="text-xs text-muted-foreground">
          Buy a home, or rent and invest the down-payment plus the monthly gap? See net worth on each path.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Home price (₹)" value={homePrice} setValue={setHomePrice} step={500000} />
        <NumberField label="Down payment (%)" value={downPct} setValue={setDownPct} step={1} />
        <NumberField label="Loan rate (% p.a.)" value={loanRate} setValue={setLoanRate} step={0.1} />
        <NumberField label="Loan tenure (yrs)" value={loanYears} setValue={setLoanYears} step={1} />
        <NumberField label="Home appreciation (% p.a.)" value={appreciation} setValue={setAppreciation} step={0.5} />
        <NumberField label="Maintenance (% / yr)" value={maintenance} setValue={setMaintenance} step={0.25} />
        <NumberField label="Monthly rent (₹)" value={rent} setValue={setRent} step={1000} />
        <NumberField label="Rent inflation (% p.a.)" value={rentInflation} setValue={setRentInflation} step={0.5} />
        <NumberField label="Equity return (% p.a.)" value={equityReturn} setValue={setEquityReturn} step={0.5} />
        <NumberField label="Compare over (yrs)" value={horizon} setValue={setHorizon} step={1} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Home loan EMI" value={`${inr(Math.round(res.emi))}/mo`} tone="cyan" />
        <Stat
          label={`Buy — net worth in ${horizon} yrs`}
          value={inr(Math.round(res.buyNetWorth))}
          tone={res.winner === "buy" ? "emerald" : undefined}
        />
        <Stat
          label={`Rent + invest — net worth`}
          value={inr(Math.round(res.rentNetWorth))}
          tone={res.winner === "rent" ? "emerald" : undefined}
        />
      </div>

      <LinesChart
        ariaLabel="Buy vs rent net worth over time"
        xLabels={res.buySeries.map((p) => `Yr ${p.year}`)}
        fmtY={(v) => inrShort(v)}
        lines={[
          { label: "Buy (home equity)", color: "#0891b2", values: res.buySeries.map((p) => p.value) },
          { label: "Rent + invest", color: "#10b981", values: res.rentSeries.map((p) => p.value) },
        ]}
      />

      <Insight tone={res.winner === "rent" ? "cyan" : "emerald"}>
        Over {horizon} years, <strong>{res.winner === "buy" ? "buying" : "renting & investing the difference"}</strong> comes out
        ahead by <strong>{inrShort(gap)}</strong>. {res.winner === "rent"
          ? "When equity is expected to out-earn property, the disciplined renter-investor wins — but a home also brings security & forced savings."
          : "A leveraged, appreciating asset plus forced savings wins here."}
      </Insight>

      <Insight tone="amber">
        Illustration only. Assumes the rent-vs-EMI surplus is invested every month without fail; ignores taxes, stamp duty,
        brokerage and emotional value of owning. Returns are not guaranteed.
      </Insight>
    </div>
  );
}
