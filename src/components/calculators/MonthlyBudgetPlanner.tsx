"use client";

/**
 * Monthly Budget Planner — group a household's inflows and outflows (Essential /
 * Lifestyle / EMIs / Investments), surface the leftover surplus, and run a
 * 50/30/20-style health diagnostic with benchmark verdicts (EFP workbook).
 *
 * Added beyond the sheet: a where-the-money-goes bar, a savings-rate + budget
 * health score, and a "grow your surplus" SIP projection (budget → wealth).
 */

import { useMemo, useState } from "react";
import { fvSip } from "@/lib/goal-planning/calc";
import { inr, Field, Stat, Insight } from "./ui";
import { inrShort } from "./charts";

type Group = Record<string, number>;
const sum = (g: Group) => Object.values(g).reduce((a, b) => a + (b || 0), 0);

const INFLOW_FIELDS = [
  { key: "income", label: "Monthly income" },
  { key: "additional", label: "Additional income" },
  { key: "rental", label: "Rental income" },
  { key: "spouse", label: "Spouse's income" },
];
const ESSENTIAL_FIELDS = [
  { key: "rent", label: "Rent & maintenance" },
  { key: "propertyTax", label: "Property tax" },
  { key: "utilities", label: "Utilities" },
  { key: "groceries", label: "Groceries" },
  { key: "transport", label: "Transportation" },
  { key: "medical", label: "Medical" },
  { key: "schoolFees", label: "School fees" },
  { key: "insurance", label: "Insurance premiums" },
];
const LIFESTYLE_FIELDS = [
  { key: "maid", label: "Maid / help" },
  { key: "shopping", label: "Shopping" },
  { key: "travel", label: "Travel" },
  { key: "dine", label: "Dine & entertainment" },
];
const EMI_FIELDS = [
  { key: "home", label: "Home loan EMI" },
  { key: "car", label: "Car loan EMI" },
  { key: "personal", label: "Personal loan EMI" },
  { key: "other", label: "Other EMIs" },
];
const INVEST_FIELDS = [
  { key: "mf", label: "Mutual funds" },
  { key: "stocks", label: "Stocks" },
  { key: "fd", label: "Fixed deposits" },
  { key: "others", label: "Others" },
];

function GroupEditor({
  title,
  fields,
  values,
  setValues,
  color,
}: {
  title: string;
  fields: { key: string; label: string }[];
  values: Group;
  setValues: (g: Group) => void;
  color: string;
}) {
  const total = sum(values);
  return (
    <div className="border rounded-lg p-3" style={{ borderColor: `${color}44` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="size-2.5 rounded-sm" style={{ background: color }} /> {title}
        </div>
        <div className="text-xs font-semibold tabular-nums">{inr(total)}</div>
      </div>
      <div className="space-y-1">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-muted-foreground">{f.label}</span>
            <input
              type="number"
              min={0}
              value={values[f.key] ?? 0}
              onChange={(e) => setValues({ ...values, [f.key]: Math.max(0, Number(e.target.value) || 0) })}
              className="input-base text-xs w-28 text-right"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

const COLORS = { essential: "#0891b2", lifestyle: "#f59e0b", emi: "#ef4444", invest: "#10b981", leftout: "#94a3b8" };

export function MonthlyBudgetPlanner() {
  const [inflows, setInflows] = useState<Group>({ income: 150000, additional: 0, rental: 0, spouse: 50000 });
  const [essential, setEssential] = useState<Group>({ rent: 35000, propertyTax: 1000, utilities: 6000, groceries: 15000, transport: 6000, medical: 3000, schoolFees: 12000, insurance: 5000 });
  const [lifestyle, setLifestyle] = useState<Group>({ maid: 4000, shopping: 6000, travel: 5000, dine: 6000 });
  const [emis, setEmis] = useState<Group>({ home: 30000, car: 10000, personal: 0, other: 0 });
  const [invest, setInvest] = useState<Group>({ mf: 20000, stocks: 5000, fd: 5000, others: 0 });
  const [projectReturn, setProjectReturn] = useState(12);
  const [projectYears, setProjectYears] = useState(20);

  const m = useMemo(() => {
    const totalIn = sum(inflows) || 1;
    const e = sum(essential), l = sum(lifestyle), em = sum(emis), iv = sum(invest);
    const out = e + l + em + iv;
    const leftout = sum(inflows) - out;
    const pct = (x: number) => x / totalIn;
    return {
      totalIn: sum(inflows), e, l, em, iv, out, leftout,
      ePct: pct(e), lPct: pct(l), emPct: pct(em), ivPct: pct(iv), leftoutPct: pct(leftout),
      savingsRate: pct(iv + Math.max(0, leftout)),
    };
  }, [inflows, essential, lifestyle, emis, invest]);

  const rows = [
    { name: "Essential expenses", val: m.e, pct: m.ePct, ok: m.ePct < 0.4, good: "In line with income", bad: "Trim unnecessary expenses", color: COLORS.essential },
    { name: "Lifestyle expenses", val: m.l, pct: m.lPct, ok: m.lPct < 0.2, good: "Healthy lifestyle spend", bad: "Cut discretionary spends", color: COLORS.lifestyle },
    { name: "EMIs (leverage)", val: m.em, pct: m.emPct, ok: m.emPct < 0.3, good: "Leverage is comfortable", bad: "Close high-rate loans ASAP", color: COLORS.emi },
    { name: "Investments", val: m.iv, pct: m.ivPct, ok: m.ivPct >= 0.2, good: "Strong savings discipline", bad: "Increase your investments", color: COLORS.invest },
    { name: "Leftover / month", val: m.leftout, pct: m.leftoutPct, ok: m.leftoutPct <= 0.1, good: "Well-allocated budget", bad: "Move idle surplus to investments", color: COLORS.leftout },
  ];
  const score = rows.filter((r) => r.ok).length;

  const bars = [
    { label: "Essential", value: m.e, color: COLORS.essential },
    { label: "Lifestyle", value: m.l, color: COLORS.lifestyle },
    { label: "EMIs", value: m.em, color: COLORS.emi },
    { label: "Investments", value: m.iv, color: COLORS.invest },
    { label: "Leftover", value: Math.max(0, m.leftout), color: COLORS.leftout },
  ];

  const surplusToInvest = Math.max(0, m.leftout);
  const surplusCorpus = surplusToInvest > 0 ? fvSip(surplusToInvest, projectReturn, projectYears * 12) : 0;

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Monthly Budget Planner</h2>
        <p className="text-xs text-muted-foreground">
          Map where every rupee goes, get a 50/30/20-style health check, and see what redirecting the surplus could become.
        </p>
      </div>

      {/* Inflows */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {INFLOW_FIELDS.map((f) => (
          <Field key={f.key} label={f.label + " (₹)"}>
            <input
              type="number"
              min={0}
              value={inflows[f.key] ?? 0}
              onChange={(e) => setInflows({ ...inflows, [f.key]: Math.max(0, Number(e.target.value) || 0) })}
              className="input-base text-sm w-full"
            />
          </Field>
        ))}
      </div>

      {/* Outflow groups */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GroupEditor title="Essential expenses" fields={ESSENTIAL_FIELDS} values={essential} setValues={setEssential} color={COLORS.essential} />
        <GroupEditor title="Lifestyle expenses" fields={LIFESTYLE_FIELDS} values={lifestyle} setValues={setLifestyle} color={COLORS.lifestyle} />
        <GroupEditor title="EMIs / Loans" fields={EMI_FIELDS} values={emis} setValues={setEmis} color={COLORS.emi} />
        <GroupEditor title="Investments" fields={INVEST_FIELDS} values={invest} setValues={setInvest} color={COLORS.invest} />
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total inflow" value={`${inr(m.totalIn)}/mo`} tone="cyan" />
        <Stat label="Total outflow" value={`${inr(m.out)}/mo`} />
        <Stat label="Leftover" value={`${inr(m.leftout)}/mo`} tone={m.leftout >= 0 ? "emerald" : "rose"} />
        <Stat label="Savings rate" value={`${(m.savingsRate * 100).toFixed(0)}%`} tone={m.savingsRate >= 0.2 ? "emerald" : "amber"} />
      </div>

      {/* Where the money goes */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Where your money goes</div>
        <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
          {bars.filter((b) => b.value > 0).map((b, i) => {
            const pct = m.totalIn > 0 ? (b.value / m.totalIn) * 100 : 0;
            return (
              <div key={i} className="h-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ width: `${Math.max(3, pct)}%`, background: b.color }} title={`${b.label}: ${pct.toFixed(0)}%`}>
                {pct >= 7 ? `${pct.toFixed(0)}%` : ""}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-[11px]">
          {bars.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: b.color }} /> {b.label} {inrShort(b.value)}
            </span>
          ))}
        </div>
      </div>

      {/* Health diagnostic */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Budget health check</div>
          <div className="text-xs font-semibold">
            Score: <span className={score >= 4 ? "text-emerald-600" : score >= 3 ? "text-amber-600" : "text-rose-600"}>{score}/5</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 px-2 border-b border-border">Category</th>
                <th className="py-1.5 px-2 border-b border-border text-right">Amount</th>
                <th className="py-1.5 px-2 border-b border-border text-right">% of income</th>
                <th className="py-1.5 px-2 border-b border-border">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="py-1.5 px-2 border-b border-border/50 font-medium">{r.name}</td>
                  <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums">{inr(r.val)}</td>
                  <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums">{(r.pct * 100).toFixed(0)}%</td>
                  <td className={`py-1.5 px-2 border-b border-border/50 ${r.ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {r.ok ? `✓ ${r.good}` : `⚠ ${r.bad}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grow the surplus */}
      <div className="rounded-lg border border-border bg-secondary/20 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Grow the leftover surplus</div>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">@</span>
            <input type="number" min={0} step={0.5} value={projectReturn} onChange={(e) => setProjectReturn(Number(e.target.value) || 0)} className="input-base text-xs w-16" />
            <span className="text-muted-foreground">% for</span>
            <input type="number" min={1} value={projectYears} onChange={(e) => setProjectYears(Number(e.target.value) || 1)} className="input-base text-xs w-16" />
            <span className="text-muted-foreground">yrs</span>
          </label>
        </div>
        <div className="text-sm mt-2">
          Investing the <strong>{inr(surplusToInvest)}/month</strong> leftover becomes{" "}
          <strong className="text-emerald-700">{inrShort(surplusCorpus)}</strong> in {projectYears} years.
        </div>
      </div>

      <Insight tone={score >= 4 ? "emerald" : "amber"}>
        {score >= 4
          ? `A healthy budget — ${score}/5 checks pass and the savings rate is ${(m.savingsRate * 100).toFixed(0)}%.`
          : `${5 - score} area(s) need attention.`}{" "}
        The benchmarks: Essentials under 40%, Lifestyle under 20%, EMIs under 30%, Investments at least 20%, and idle leftover under 10%
        of income. Redirecting the surplus into a SIP turns budgeting discipline into real wealth.
      </Insight>
    </div>
  );
}
