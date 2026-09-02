"use client";

/**
 * Portfolio Health Score - meeting-room diagnostic for an investor portfolio.
 * This is intentionally manual-input for now, so an RM can use it with any
 * prospect or client before the portfolio is fully imported.
 */

import { useMemo, useState } from "react";
import { BarsChart, inrShort } from "./charts";
import { Field, inr, Insight, NumberField, Segmented, Stat, Table } from "./ui";

type RiskProfile = "conservative" | "balanced" | "aggressive";
type ScoreTone = "emerald" | "amber" | "rose" | "cyan";

const TARGETS: Record<RiskProfile, { equity: number; debt: number; gold: number; cash: number; label: string }> = {
  conservative: { equity: 35, debt: 50, gold: 10, cash: 5, label: "Conservative" },
  balanced: { equity: 60, debt: 30, gold: 5, cash: 5, label: "Balanced" },
  aggressive: { equity: 80, debt: 15, gold: 5, cash: 0, label: "Aggressive" },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function allocationScore(current: number, target: number, weight: number): number {
  const gap = Math.abs(current - target);
  return weight * clamp(1 - gap / 35, 0, 1);
}

function scoreBand(score: number): { label: string; tone: ScoreTone; next: string } {
  if (score >= 80) return { label: "Healthy", tone: "emerald", next: "Maintain allocation and schedule periodic reviews." };
  if (score >= 60) return { label: "Needs review", tone: "amber", next: "Prioritise rebalancing and goal mapping." };
  return { label: "Action required", tone: "rose", next: "Run a full portfolio review before adding fresh money." };
}

export function PortfolioHealthScore() {
  const [clientName, setClientName] = useState("");
  const [risk, setRisk] = useState<RiskProfile>("balanced");
  const [portfolioValue, setPortfolioValue] = useState(5000000);
  const [fundCount, setFundCount] = useState(12);
  const [equityPct, setEquityPct] = useState(72);
  const [debtPct, setDebtPct] = useState(18);
  const [goldPct, setGoldPct] = useState(5);
  const [cashPct, setCashPct] = useState(5);
  const [goalMappedPct, setGoalMappedPct] = useState(45);
  const [requiredSip, setRequiredSip] = useState(50000);
  const [activeSip, setActiveSip] = useState(28000);
  const [underperformers, setUnderperformers] = useState(3);
  const [monthsSinceReview, setMonthsSinceReview] = useState(11);

  const result = useMemo(() => {
    const t = TARGETS[risk];
    const allocation =
      allocationScore(equityPct, t.equity, 12) +
      allocationScore(debtPct, t.debt, 8) +
      allocationScore(goldPct, t.gold, 3) +
      allocationScore(cashPct, t.cash, 2);

    const diversification =
      fundCount <= 0 ? 0
        : fundCount <= 8 ? 15
          : fundCount <= 15 ? 12
            : fundCount <= 24 ? 8
              : 4;
    const goalMapping = clamp(goalMappedPct, 0, 100) * 0.2;
    const sipCoverage = requiredSip <= 0 ? 15 : clamp(activeSip / requiredSip, 0, 1.4) * 15;
    const review = monthsSinceReview <= 3 ? 10 : monthsSinceReview <= 6 ? 8 : monthsSinceReview <= 12 ? 5 : 2;
    const quality = 15 * clamp(1 - underperformers / Math.max(1, fundCount), 0, 1);

    const score = Math.round(allocation + diversification + goalMapping + sipCoverage + review + quality);
    const band = scoreBand(score);
    const allocationDrift = Math.abs(equityPct - t.equity) + Math.abs(debtPct - t.debt) + Math.abs(goldPct - t.gold) + Math.abs(cashPct - t.cash);
    const unmappedValue = portfolioValue * (1 - clamp(goalMappedPct, 0, 100) / 100);
    const sipGap = Math.max(0, requiredSip - activeSip);
    const reviewPriority = clamp(
      Math.round((100 - score) * 0.55 + Math.min(25, allocationDrift * 0.4) + Math.min(20, unmappedValue / 500000)),
      0,
      100,
    );

    const actions = [
      allocationDrift > 25 ? "Rebalance asset allocation before adding fresh equity exposure." : "Allocation is close enough for a regular review.",
      goalMappedPct < 70 ? `Map ${inr(unmappedValue)} to specific goals.` : "Goal mapping is strong.",
      sipGap > 0 ? `Increase SIP by ${inr(sipGap)}/month to cover the plan gap.` : "SIP coverage is adequate.",
      underperformers > 0 ? `Review ${underperformers} underperforming fund${underperformers === 1 ? "" : "s"}.` : "No underperforming fund count entered.",
    ];

    return {
      target: t,
      score,
      band,
      allocation,
      diversification,
      goalMapping,
      sipCoverage,
      review,
      quality,
      allocationDrift,
      unmappedValue,
      sipGap,
      reviewPriority,
      actions,
    };
  }, [activeSip, cashPct, debtPct, equityPct, fundCount, goalMappedPct, goldPct, monthsSinceReview, portfolioValue, requiredSip, risk, underperformers]);

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Portfolio Health Score</h2>
        <p className="text-xs text-muted-foreground">
          A 100-point diagnostic for allocation, diversification, goal mapping, SIP coverage, review recency and fund quality.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <Segmented
            label="Risk profile"
            value={risk}
            onChange={setRisk}
            options={[
              { value: "conservative", label: "Conservative" },
              { value: "balanced", label: "Balanced" },
              { value: "aggressive", label: "Aggressive" },
            ]}
          />
        </div>
        <NumberField label="Portfolio value (INR)" value={portfolioValue} setValue={setPortfolioValue} step={100000} />
        <NumberField label="No. of funds" value={fundCount} setValue={setFundCount} step={1} />
        <NumberField label="Equity allocation (%)" value={equityPct} setValue={setEquityPct} step={1} />
        <NumberField label="Debt allocation (%)" value={debtPct} setValue={setDebtPct} step={1} />
        <NumberField label="Gold allocation (%)" value={goldPct} setValue={setGoldPct} step={1} />
        <NumberField label="Cash allocation (%)" value={cashPct} setValue={setCashPct} step={1} />
        <NumberField label="Goal mapped (%)" value={goalMappedPct} setValue={setGoalMappedPct} step={5} />
        <NumberField label="Required SIP / month" value={requiredSip} setValue={setRequiredSip} step={1000} />
        <NumberField label="Active SIP / month" value={activeSip} setValue={setActiveSip} step={1000} />
        <NumberField label="Underperforming funds" value={underperformers} setValue={setUnderperformers} step={1} />
        <NumberField label="Months since review" value={monthsSinceReview} setValue={setMonthsSinceReview} step={1} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Health score" value={`${result.score}/100`} tone={result.band.tone} />
        <Stat label="Band" value={result.band.label} tone={result.band.tone} />
        <Stat label="Unmapped portfolio" value={inr(result.unmappedValue)} tone={result.unmappedValue > 0 ? "amber" : "emerald"} />
        <Stat label="Review priority" value={`${result.reviewPriority}/100`} tone={result.reviewPriority >= 70 ? "rose" : result.reviewPriority >= 45 ? "amber" : "emerald"} />
      </div>

      <BarsChart
        fmtV={(v) => `${Math.round(v)} pts`}
        bars={[
          { label: "Allocation", value: result.allocation, display: `${Math.round(result.allocation)}/25`, color: "#0891b2" },
          { label: "Diversify", value: result.diversification, display: `${Math.round(result.diversification)}/15`, color: "#6366f1" },
          { label: "Goals", value: result.goalMapping, display: `${Math.round(result.goalMapping)}/20`, color: "#10b981" },
          { label: "SIP cover", value: result.sipCoverage, display: `${Math.round(result.sipCoverage)}/15`, color: "#f59e0b" },
          { label: "Review", value: result.review, display: `${Math.round(result.review)}/10`, color: "#8b5cf6" },
          { label: "Quality", value: result.quality, display: `${Math.round(result.quality)}/15`, color: "#ef4444" },
        ]}
      />

      <Table
        head={["Metric", "Current", "Target / guide"]}
        rows={[
          ["Equity", `${equityPct}%`, `${result.target.equity}%`],
          ["Debt", `${debtPct}%`, `${result.target.debt}%`],
          ["Gold", `${goldPct}%`, `${result.target.gold}%`],
          ["Cash", `${cashPct}%`, `${result.target.cash}%`],
          ["Goal-mapped value", inr(portfolioValue - result.unmappedValue), `${result.target.label} plan`],
          ["Monthly SIP gap", inr(result.sipGap), "Close goal funding gap"],
        ]}
      />

      <Insight tone={result.band.tone}>
        {clientName || "This portfolio"} scores <strong>{result.score}/100</strong>. {result.band.next}
        {" "}Biggest RM talking point: <strong>{result.actions.find((a) => !a.includes("strong") && !a.includes("adequate")) ?? result.actions[0]}</strong>
      </Insight>

      <Insight tone="cyan">
        Conversation notes: {result.actions.join(" ")} Potential review value at stake: <strong>{inrShort(result.unmappedValue)}</strong>.
      </Insight>
    </div>
  );
}
