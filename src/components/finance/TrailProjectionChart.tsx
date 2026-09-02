"use client";

import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Forward 12-month trail projection. Unlike the static run-rate, this grows the
 * book by net SIP inflow each month + an adjustable market-growth assumption, so
 * the owner sees where trail is actually headed. Pure client-side math — the
 * slider recomputes instantly, no server round-trip.
 */
export function TrailProjectionChart({
  baseAum,
  monthlySipInflow,
  weightedTrailPct,
  staticAnnual,
}: {
  baseAum: number;
  monthlySipInflow: number;
  weightedTrailPct: number; // e.g. 0.65 (% p.a.)
  staticAnnual: number;
}) {
  const [growth, setGrowth] = useState(8); // % annual market growth assumption

  const proj = useMemo(() => {
    const out: { m: number; aum: number; trail: number; cum: number }[] = [];
    let aum = baseAum;
    let cum = 0;
    const mTrail = weightedTrailPct / 100 / 12;
    const mGrow = growth / 100 / 12;
    for (let i = 1; i <= 12; i++) {
      aum = aum * (1 + mGrow) + monthlySipInflow;
      const t = aum * mTrail;
      cum += t;
      out.push({ m: i, aum, trail: t, cum });
    }
    return out;
  }, [baseAum, monthlySipInflow, weightedTrailPct, growth]);

  const eoy = proj[proj.length - 1];
  const eoyTrail = eoy?.cum ?? 0;
  const eoyAum = eoy?.aum ?? baseAum;
  const upliftPct = staticAnnual > 0 ? ((eoyTrail - staticAnnual) / staticAnnual) * 100 : 0;

  const W = 640, H = 120, P = 4;
  const maxT = Math.max(...proj.map((p) => p.trail), 1);
  const months = ["1m", "", "3m", "", "", "6m", "", "", "9m", "", "", "12m"];

  return (
    <div className="card-surface p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="section-title flex items-center gap-2">
          <TrendingUp className="size-4 text-brand-cyan" /> 12-month forward projection
        </h2>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Market growth
          <input type="range" min={0} max={20} step={1} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} className="w-32 accent-brand-cyan" />
          <span className="font-semibold text-foreground tabular-nums w-10">{growth}% p.a.</span>
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Projected trail (next 12 mo)" value={inr(eoyTrail)} accent />
        <Stat label="vs flat run-rate" value={`${upliftPct >= 0 ? "+" : ""}${upliftPct.toFixed(0)}%`} sub={inr(staticAnnual)} />
        <Stat label="Projected AUM (EOY)" value={inr(eoyAum)} sub={`from ${inr(baseAum)}`} />
        <Stat label="Net SIP inflow / mo" value={inr(monthlySipInflow)} sub="from healthy SIPs" />
      </div>

      {/* Monthly trail bars */}
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="overflow-visible">
          {proj.map((p, i) => {
            const bw = (W - P * 2) / 12 - 4;
            const x = P + i * ((W - P * 2) / 12) + 2;
            const h = (p.trail / maxT) * (H - 20);
            return <rect key={i} x={x} y={H - 16 - h} width={bw} height={h} rx={2} fill="#0891b2" opacity={0.85} />;
          })}
        </svg>
        <div className="flex justify-between text-[10px] text-muted-foreground px-1">
          {months.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Each month grows AUM by your healthy SIP inflow + the market assumption, then earns trail at your blended {weightedTrailPct.toFixed(2)}% p.a.
        Set growth to 0% for a pure-inflow, market-neutral view.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-brand-cyan/30 bg-brand-cyan-light/20" : "border-border bg-card"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${accent ? "text-brand-cyan-deep" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
