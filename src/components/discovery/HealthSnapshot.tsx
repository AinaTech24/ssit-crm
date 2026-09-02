"use client";

import { TrendingUp, TrendingDown, Wallet, Shield, PiggyBank, Target } from "lucide-react";
import type { DiscoveryComputed } from "@/lib/discovery/calc";
import { PRODUCTS, PRODUCT_LABELS, type Verdict } from "@/lib/discovery/risk";

const VERDICT: Record<Verdict, { mark: string; cls: string }> = {
  yes: { mark: "✅", cls: "text-emerald-600" },
  maybe: { mark: "⚠", cls: "text-amber-500" },
  no: { mark: "❌", cls: "text-rose-500" },
  na: { mark: "—", cls: "text-muted-foreground" },
};

const inr = (nv: number) => {
  const v = Math.round(nv);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
};

/**
 * The live "Financial Health Snapshot" — score ring + the numbers a client
 * reacts to (net worth, monthly investable surplus, insurance gap, goal
 * affordability). Recomputes instantly as the form changes. Pure display.
 */
export function HealthSnapshot({ c, sticky }: { c: DiscoveryComputed; sticky?: boolean }) {
  const bandColor =
    c.healthBand === "Excellent" ? "text-emerald-600" : c.healthBand === "Good" ? "text-brand-cyan-deep" : c.healthBand === "Fair" ? "text-amber-500" : "text-rose-500";
  const ringStroke =
    c.healthScore >= 80 ? "#059669" : c.healthScore >= 60 ? "#0891b2" : c.healthScore >= 40 ? "#f59e0b" : "#f43f5e";

  return (
    <div className={`card-surface p-5 space-y-4 ${sticky ? "lg:sticky lg:top-4" : ""}`}>
      <div className="flex items-center gap-4">
        <div className="relative size-20 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" className="text-secondary" strokeWidth="3.2" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={ringStroke} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${c.healthScore} ${100 - c.healthScore}`} />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center leading-none">
              <div className="text-xl font-bold" style={{ color: ringStroke }}>{c.healthScore}</div>
              <div className="text-[8px] text-muted-foreground">/ 100</div>
            </div>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Financial health</div>
          <div className={`text-lg font-bold ${bandColor}`}>{c.healthBand}</div>
        </div>
      </div>

      {/* Score pillars */}
      <div className="space-y-1.5">
        {c.scoreParts.map((p) => (
          <div key={p.label}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{p.label}</span>
              <span className="tabular-nums font-medium">{p.score}/{p.max}</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(p.score / p.max) * 100}%`, background: p.score / p.max >= 0.75 ? "#10b981" : p.score / p.max >= 0.4 ? "#f59e0b" : "#f43f5e" }} />
            </div>
          </div>
        ))}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Metric icon={Wallet} label="Net worth" value={inr(c.netWorth)} tone={c.netWorth >= 0 ? "emerald" : "rose"} />
        <Metric icon={PiggyBank} label="Monthly surplus" value={inr(c.monthlySipCapacity)} tone={c.monthlySipCapacity >= 0 ? "emerald" : "rose"} sub="investable / mo" />
        <Metric icon={Shield} label="Life cover gap" value={c.lifeCoverGap > 0 ? inr(c.lifeCoverGap) : "Covered"} tone={c.lifeCoverGap > 0 ? "rose" : "emerald"} />
        <Metric icon={Target} label="Goal SIP needed" value={inr(c.totalSipNeeded)} sub="per month" />
      </div>

      {/* Affordability verdict */}
      {(c.totalSipNeeded > 0 || c.monthlySipCapacity !== 0) && (
        <div className={`rounded-lg border p-3 text-xs ${c.affordabilityGap >= 0 ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
          <div className="flex items-center gap-1.5 font-semibold">
            {c.affordabilityGap >= 0 ? <TrendingUp className="size-3.5 text-emerald-600" /> : <TrendingDown className="size-3.5 text-amber-600" />}
            {c.affordabilityGap >= 0 ? "Goals are affordable" : "Goals need more than the current surplus"}
          </div>
          <p className="text-muted-foreground mt-1">
            Investable ~<b>{inr(c.monthlySipCapacity)}</b>/mo vs goal SIPs ~<b>{inr(c.totalSipNeeded)}</b>/mo
            {c.affordabilityGap >= 0
              ? ` — ₹${Math.round(c.affordabilityGap).toLocaleString("en-IN")}/mo to spare.`
              : ` — short by ₹${Math.round(Math.abs(c.affordabilityGap)).toLocaleString("en-IN")}/mo. Prioritise goals or extend timelines.`}
          </p>
        </div>
      )}

      {/* Risk profile + product suitability (auto from the Risk-profile section) */}
      {c.risk && c.risk.answered > 0 && (
        <div className="space-y-2.5 pt-3 border-t border-border">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Risk profile</div>
              <div className="text-base font-bold leading-tight" style={{ color: c.risk.bandColor }}>{c.risk.bandLabel}</div>
            </div>
            <div className="text-right leading-tight">
              <div className="text-lg font-bold tabular-nums" style={{ color: c.risk.bandColor }}>
                {c.risk.score}<span className="text-[10px] text-muted-foreground">/{c.risk.max}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">{c.risk.answered}/{c.risk.total} parameters</div>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(c.risk.score / c.risk.max) * 100}%`, background: c.risk.bandColor }} />
          </div>

          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pt-0.5">Product suitability</div>
          <div className="grid grid-cols-2 gap-1.5">
            {PRODUCTS.map((p) => {
              const cell = c.risk.suitability[p];
              const vrd = VERDICT[cell.overall];
              return (
                <div key={p} className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1">
                  <span className="text-[11px] truncate">{PRODUCT_LABELS[p]}</span>
                  <span className={`text-xs ${vrd.cls}`} title={`risk ${cell.risk} · horizon ${cell.horizon} · surplus ${cell.surplus} · liquidity ${cell.liquidity}`}>{vrd.mark}</span>
                </div>
              );
            })}
          </div>
          <div className="text-[9px] text-muted-foreground">✅ suitable · ⚠ conditional · ❌ not suitable · — needs more inputs</div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: "emerald" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground"><Icon className="size-3" /> {label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
