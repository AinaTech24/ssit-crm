"use client";

/**
 * Unconventional SWP — "OPM (Other People's Money) to buy a House".
 *
 * Instead of paying cash for the house, take the home loan AND invest the same
 * amount in an equity fund, then run an SWP that withdraws each EMI. While the
 * fund return exceeds the loan rate the corpus outlives the loan, so once the
 * loan is cleared a corpus still remains — the house effectively funded by the
 * bank's money. Math + verification: src/lib/goal-planning/calc.ts →
 * opmHouseStrategy (matches the workbook to the rupee on the reference case:
 * EMI ₹88,690.36 · total interest ₹1,12,85,686.52 · corpus left ₹2,03,10,747.42).
 */

import { useMemo, useState } from "react";
import { opmHouseStrategy } from "@/lib/goal-planning/calc";
import { inr, fmtPct, NumberField, Field, Section, Stat, Table, Insight } from "./ui";

export function OpmHousePlanner() {
  const [clientName, setClientName] = useState("");
  const [loanAmount, setLoanAmount] = useState(10000000);
  const [loanRate, setLoanRate] = useState(8.8);
  const [tenureYears, setTenureYears] = useState(20);
  const [mfReturn, setMfReturn] = useState(12);

  const res = useMemo(
    () => opmHouseStrategy({ loanAmount, loanRatePct: loanRate, tenureYears, mfReturnPct: mfReturn }),
    [loanAmount, loanRate, tenureYears, mfReturn],
  );

  const spread = mfReturn - loanRate;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Unconventional SWP — OPM to Buy a House</h2>
        <p className="text-xs text-muted-foreground">
          Borrow for the house, invest the same amount in an equity fund, and run an SWP that pays every EMI.
          When the fund earns more than the loan costs, the corpus outlives the loan — the house funded by the
          bank&rsquo;s money while your capital keeps compounding.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumberField label="Loan amount = amount invested (₹)" value={loanAmount} setValue={setLoanAmount} step={500000} />
        <NumberField label="Loan interest rate (% p.a.)" value={loanRate} setValue={setLoanRate} step={0.1} />
        <NumberField label="Tenure (years)" value={tenureYears} setValue={setTenureYears} step={1} />
        <NumberField label="Expected MF return (% p.a.)" value={mfReturn} setValue={setMfReturn} step={0.5} />
      </div>

      <Section n={1} title="The numbers">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Monthly EMI" value={inr(res.emi)} tone="cyan" />
          <Stat label="Total paid (all EMIs)" value={inr(res.totalPaid)} />
          <Stat label="Total interest" value={inr(res.totalInterest)} tone="amber" />
          <Stat label={`Corpus left after ${tenureYears} yrs`} value={inr(res.corpusLeft)} tone="emerald" />
        </div>
      </Section>

      <OpmChart yearly={res.yearly} loan={loanAmount} />

      <Section n={2} title="Year-by-year">
        <Table
          head={["Year", "Loan outstanding", "MF corpus", "Cumulative interest", "Cumulative EMIs"]}
          rows={res.yearly.map((y) => [
            y.year,
            inr(y.loanBalance),
            inr(y.mfCorpus),
            inr(y.cumInterest),
            inr(y.cumWithdrawal),
          ])}
          highlightLastRow
          highlightCol={2}
        />
      </Section>

      {res.corpusSurvived ? (
        <Insight tone="emerald">
          With a <strong>{fmtPct(spread)}</strong> spread (fund {fmtPct(mfReturn)} vs loan {fmtPct(loanRate)}), the SWP funds every
          EMI and the loan clears in {tenureYears} years — yet <strong>{inr(res.corpusLeft)}</strong> of corpus remains. The house is
          effectively paid for by the bank&rsquo;s money while your capital kept compounding.
        </Insight>
      ) : (
        <Insight tone="rose">
          At fund {fmtPct(mfReturn)} vs loan {fmtPct(loanRate)} the corpus is drawn down faster than it grows and runs out before the
          loan is repaid (lowest balance {inr(res.minCorpus)}). The strategy only holds while the expected return comfortably exceeds
          the loan rate.
        </Insight>
      )}

      <Insight tone="amber">
        Illustration only. Mutual-fund returns are market-linked and <strong>not guaranteed</strong>; a poor sequence of returns early
        in the plan can exhaust the corpus even if the long-run average looks fine. SWP withdrawals may attract capital-gains tax. Use
        a conservative return assumption and keep a buffer before recommending a leverage strategy.
      </Insight>
    </div>
  );
}

/* ── Dual-line chart: loan outstanding (→₹0) vs MF corpus (survives & grows) ── */
function OpmChart({
  yearly,
  loan,
}: {
  yearly: { year: number; loanBalance: number; mfCorpus: number }[];
  loan: number;
}) {
  const W = 640;
  const H = 220;
  const padL = 6;
  const padR = 6;
  const padT = 16;
  const padB = 18;
  // Prepend year 0 (loan fully outstanding; corpus just invested).
  const pts = [{ year: 0, loanBalance: loan, mfCorpus: loan }, ...yearly];
  const n = pts.length;
  if (n < 2) return null;
  const maxV = Math.max(loan, ...pts.map((p) => Math.max(p.loanBalance, p.mfCorpus)), 1);
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - Math.max(0, v) / maxV) * (H - padT - padB);
  const line = (key: "loanBalance" | "mfCorpus") =>
    pts.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="border rounded-md p-3">
      <div className="flex items-center gap-4 mb-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-rose-500" /> Loan outstanding
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> MF corpus
        </span>
        <span className="ml-auto text-muted-foreground">Loan amortises to ₹0; corpus survives &amp; grows</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Loan outstanding versus MF corpus over the tenure">
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(maxV * g)}
              y2={y(maxV * g)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
            <text x={padL} y={y(maxV * g) - 2} className="fill-muted-foreground" fontSize={9}>
              {compact(maxV * g)}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="#ef4444" strokeWidth={2} points={line("loanBalance")} />
        <polyline fill="none" stroke="#10b981" strokeWidth={2.5} points={line("mfCorpus")} />
      </svg>
    </div>
  );
}

/** Compact INR (₹X Cr / ₹X L / ₹Xk) — chart axis labels. */
function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${Math.round(n)}`;
}
