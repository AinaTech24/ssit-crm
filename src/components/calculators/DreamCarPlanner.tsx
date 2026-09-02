"use client";

/**
 * Dream Car — Invest First vs Auto-loan. The cost of borrowing for a
 * depreciating asset vs investing now and buying it in cash later.
 * Math: src/lib/calculators/advisory.ts → dreamCar.
 */

import { useMemo, useState } from "react";
import { dreamCar } from "@/lib/calculators/advisory";
import { inr, NumberField, Field, Stat, Insight } from "./ui";
import { BarsChart, inrShort } from "./charts";

export function DreamCarPlanner() {
  const [clientName, setClientName] = useState("");
  const [price, setPrice] = useState(1500000);
  const [yearsToBuy, setYearsToBuy] = useState(4);
  const [carInflation, setCarInflation] = useState(6);
  const [investReturn, setInvestReturn] = useState(11);
  const [downPct, setDownPct] = useState(20);
  const [loanRate, setLoanRate] = useState(9.5);
  const [loanYears, setLoanYears] = useState(5);

  const res = useMemo(
    () =>
      dreamCar({
        carPriceToday: price,
        yearsToBuy,
        carInflationPct: carInflation,
        investReturnPct: investReturn,
        downPaymentPct: downPct,
        loanRatePct: loanRate,
        loanYears,
      }),
    [price, yearsToBuy, carInflation, investReturn, downPct, loanRate, loanYears],
  );

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Dream Car — Invest First</h2>
        <p className="text-xs text-muted-foreground">
          Borrow now for a depreciating asset, or invest first and buy it in cash? See the real cost of the EMI.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Car price today (₹)" value={price} setValue={setPrice} step={100000} />
        <NumberField label="Buy in (years)" value={yearsToBuy} setValue={setYearsToBuy} step={1} />
        <NumberField label="Car price inflation (% p.a.)" value={carInflation} setValue={setCarInflation} step={0.5} />
        <NumberField label="Invest return (% p.a.)" value={investReturn} setValue={setInvestReturn} step={0.5} />
        <NumberField label="Loan down-payment (%)" value={downPct} setValue={setDownPct} step={5} />
        <NumberField label="Auto-loan rate (% p.a.)" value={loanRate} setValue={setLoanRate} step={0.1} />
        <NumberField label="Auto-loan tenure (yrs)" value={loanYears} setValue={setLoanYears} step={1} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`Car price in ${yearsToBuy} yrs`} value={inrShort(res.futurePrice)} tone="amber" />
        <Stat label="Invest-first SIP" value={`${inr(Math.round(res.sipToBuyCash))}/mo`} tone="emerald" />
        <Stat label="Auto-loan EMI" value={`${inr(Math.round(res.emi))}/mo`} tone="cyan" />
        <Stat label="Loan interest paid" value={inrShort(res.loanInterest)} tone="rose" />
      </div>

      <BarsChart
        fmtV={(v) => inrShort(v)}
        bars={[
          { label: "Invest first (cash)", value: res.investedCash, color: "#10b981" },
          { label: "Buy now on loan", value: res.loanTotal, color: "#f43f5e" },
        ]}
      />

      <Insight tone="emerald">
        Buying on loan today costs <strong>{inrShort(res.loanTotal)}</strong> ({inrShort(res.loanInterest)} of it pure interest on a
        depreciating asset). Investing <strong>{inr(Math.round(res.sipToBuyCash))}/month</strong> for {yearsToBuy} years lets{" "}
        {clientName || "your client"} buy the {inrShort(res.futurePrice)} car in cash for just{" "}
        <strong>{inrShort(res.investedCash)}</strong> invested — and arrive debt-free.
      </Insight>
    </div>
  );
}
