"use client";

/**
 * The REAL Statement — Net Worth & Cashflow discovery tool (Network FP QPFP
 * "REAL Statement" parity). REAL = Revenue · Expenses · Assets · Liabilities.
 *
 * Captures a household's full financial position in one statement:
 *   - Income (Revenue) → Total Income (monthly + annual)
 *   - Expenses, grouped (Household / Lifestyle / Dependent / Insurance / EMIs)
 *   - Savings = Income − Expenses; Surplus = Savings − ongoing investments
 *   - Assets, grouped (Liquid / Debt / Equity / Gold / Real Estate / Personal)
 *   - Liabilities → Net Worth (Notional incl. personal assets, Actual excl.)
 *
 * Beyond the sheet (advisor value-add): savings/expense ratios, emergency-fund
 * months, leverage + solvency ratios, and an asset-mix bar.
 */

import { useMemo, useState } from "react";
import { inr, Field, Stat, Insight, Section } from "./ui";
import { inrShort } from "./charts";

type Group = Record<string, number>;
const sum = (g: Group) => Object.values(g).reduce((a, b) => a + (b || 0), 0);
const pctOf = (x: number, base: number) => (base > 0 ? (x / base) * 100 : 0);

// ── Income (monthly amounts; annual = ×12) ──
const INCOME_FIELDS = [
  { key: "salary", label: "Salary (Husband + Wife)" },
  { key: "bonus", label: "Bonus / variable (monthly avg)" },
  { key: "business", label: "Business income" },
  { key: "rental", label: "Rental income" },
  { key: "investment", label: "Investment income" },
];

// ── Expense groups ──
const HOUSEHOLD = [
  { key: "rent", label: "House rent" },
  { key: "society", label: "Society / maintenance / repair" },
  { key: "food", label: "Food, grocery & toiletries" },
  { key: "vehicle", label: "Vehicle — fuel / maintenance / travel" },
  { key: "health", label: "Medicines / doctor / healthcare" },
  { key: "utilities", label: "Electricity / water / AMCs" },
  { key: "help", label: "Domestic help / driver" },
  { key: "telecom", label: "Mobile / internet" },
  { key: "subs", label: "TV / newspapers / subscriptions" },
  { key: "otherHh", label: "Others" },
];
const LIFESTYLE = [
  { key: "clothes", label: "Clothes & accessories" },
  { key: "shopping", label: "Shopping / gifts / gadgets" },
  { key: "dining", label: "Dining / movies / sports" },
  { key: "personalCare", label: "Personal care — salon / spa / gym" },
  { key: "travel", label: "Travel & annual vacations" },
  { key: "advisors", label: "Coach / advisor / CA fees" },
  { key: "hobbies", label: "Hobbies / club memberships" },
  { key: "courses", label: "Professional courses / education" },
  { key: "charity", label: "Charity / donations" },
  { key: "otherLs", label: "Others" },
];
const DEPENDENT = [
  { key: "children", label: "Children — school / college / tuitions" },
  { key: "parents", label: "Contribution to parents" },
  { key: "relatives", label: "Siblings / relatives" },
];
const INS_PREMIUMS = [
  { key: "life", label: "Life insurance (term / pure)" },
  { key: "healthIns", label: "Health insurance (mediclaim / PA / CI)" },
  { key: "general", label: "General insurance (motor & others)" },
];
const LOAN_EMIS = [
  { key: "homeEmi", label: "Home loan EMI" },
  { key: "vehicleEmi", label: "Vehicle loan EMI" },
  { key: "otherEmi", label: "Other loan EMIs" },
];
const ONGOING_INV = [
  { key: "mfSip", label: "MF SIPs" },
  { key: "policiesRd", label: "Policies / RDs" },
  { key: "otherInv", label: "Others" },
];

// ── Asset groups (present value) ──
const LIQUID = [
  { key: "savingsBank", label: "Savings bank" },
  { key: "liquidFunds", label: "Liquid funds" },
  { key: "cash", label: "Cash in hand" },
];
const DEBT = [
  { key: "fd", label: "Fixed deposits" },
  { key: "ppf", label: "PPF" },
  { key: "epf", label: "EPF / SA / gratuity" },
  { key: "nsc", label: "NSC / POMIS / KVP / RDs" },
  { key: "npsDebt", label: "NPS (debt portion)" },
  { key: "debtMf", label: "Debt mutual funds" },
  { key: "insSv", label: "Insurance policies — surrender value" },
  { key: "bonds", label: "Bonds / debentures / CDs" },
];
const EQUITY = [
  { key: "directEq", label: "Direct equity / PMS / AIF" },
  { key: "equityMf", label: "Equity mutual funds" },
  { key: "npsEq", label: "NPS (equity portion)" },
  { key: "ulip", label: "ULIPs — surrender value" },
];
const GOLD = [
  { key: "goldEtf", label: "Gold ETFs / funds" },
  { key: "goldPhysical", label: "Gold bars / coins" },
];
const REAL_ESTATE = [
  { key: "apartment", label: "Apartment / house (investment)" },
  { key: "plot", label: "Plot / land / holiday home" },
  { key: "reits", label: "Real estate funds / REITs" },
];
const PERSONAL = [
  { key: "primaryHouse", label: "Primary house" },
  { key: "vehicles", label: "Vehicles" },
  { key: "jewellery", label: "Jewellery" },
];
const LIABILITIES = [
  { key: "homeLoan", label: "Home loan — outstanding" },
  { key: "vehicleLoan", label: "Vehicle loan — outstanding" },
  { key: "personalLoan", label: "Personal loan" },
  { key: "educationLoan", label: "Education loan" },
  { key: "otherLoan", label: "Other loans (gold loan etc.)" },
  { key: "creditCard", label: "Credit card outstanding" },
];

function GroupEditor({
  title, fields, values, setValues, color, suffix,
}: {
  title: string;
  fields: { key: string; label: string }[];
  values: Group;
  setValues: (g: Group) => void;
  color: string;
  suffix?: string;
}) {
  const total = sum(values);
  return (
    <div className="border rounded-lg p-3" style={{ borderColor: `${color}44` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="size-2.5 rounded-sm" style={{ background: color }} /> {title}
        </div>
        <div className="text-xs font-semibold tabular-nums">{inr(total)}{suffix}</div>
      </div>
      <div className="space-y-1">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-muted-foreground">{f.label}</span>
            <input
              type="number" min={0} value={values[f.key] ?? 0}
              onChange={(e) => setValues({ ...values, [f.key]: Math.max(0, Number(e.target.value) || 0) })}
              className="input-base text-xs w-32 text-right"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

const C = {
  income: "#10b981", household: "#0891b2", lifestyle: "#f59e0b", dependent: "#8b5cf6",
  insurance: "#14b8a6", emi: "#ef4444",
  liquid: "#06b6d4", debt: "#f59e0b", equity: "#10b981", gold: "#eab308", realestate: "#6366f1", personal: "#94a3b8",
};

export function RealStatement() {
  // Defaults seed the Network FP worked example (Arvind Sharma) so it opens with
  // a complete illustration; advisors overwrite with the client's real numbers.
  const [income, setIncome] = useState<Group>({ salary: 140000, bonus: 20833, business: 0, rental: 0, investment: 0 });
  const [household, setHousehold] = useState<Group>({ rent: 0, society: 0, food: 15000, vehicle: 0, health: 5000, utilities: 7000, help: 0, telecom: 2000, subs: 3000, otherHh: 8000 });
  const [lifestyle, setLifestyle] = useState<Group>({ clothes: 0, shopping: 10000, dining: 0, personalCare: 10000, travel: 0, advisors: 0, hobbies: 0, courses: 0, charity: 0, otherLs: 0 });
  const [dependent, setDependent] = useState<Group>({ children: 12500, parents: 0, relatives: 0 });
  const [insurance, setInsurance] = useState<Group>({ life: 5500, healthIns: 2500, general: 0 });
  const [emis, setEmis] = useState<Group>({ homeEmi: 0, vehicleEmi: 0, otherEmi: 0 });
  const [ongoing, setOngoing] = useState<Group>({ mfSip: 0, policiesRd: 0, otherInv: 0 });

  const [liquid, setLiquid] = useState<Group>({ savingsBank: 180000, liquidFunds: 0, cash: 0 });
  const [debt, setDebt] = useState<Group>({ fd: 900000, ppf: 0, epf: 850000, nsc: 0, npsDebt: 0, debtMf: 0, insSv: 0, bonds: 0 });
  const [equity, setEquity] = useState<Group>({ directEq: 0, equityMf: 1400000, npsEq: 0, ulip: 0 });
  const [gold, setGold] = useState<Group>({ goldEtf: 0, goldPhysical: 0 });
  const [realEstate, setRealEstate] = useState<Group>({ apartment: 9500000, plot: 1800000, reits: 0 });
  const [personal, setPersonal] = useState<Group>({ primaryHouse: 0, vehicles: 600000, jewellery: 0 });
  const [liabilities, setLiabilities] = useState<Group>({ homeLoan: 2200000, vehicleLoan: 300000, personalLoan: 0, educationLoan: 0, otherLoan: 0, creditCard: 0 });

  const m = useMemo(() => {
    const incomeM = sum(income);
    const incomeA = incomeM * 12;
    const expM = sum(household) + sum(lifestyle) + sum(dependent) + sum(insurance) + sum(emis);
    const expA = expM * 12;
    const savingsM = incomeM - expM;
    const ongoingM = sum(ongoing);
    const surplusM = savingsM - ongoingM;

    const tLiquid = sum(liquid), tDebt = sum(debt), tEquity = sum(equity), tGold = sum(gold), tRe = sum(realEstate), tPersonal = sum(personal);
    const totalAssets = tLiquid + tDebt + tEquity + tGold + tRe + tPersonal;
    const totalLiab = sum(liabilities);
    const notionalNW = totalAssets - totalLiab;
    const actualNW = (totalAssets - tPersonal) - totalLiab;
    // Investable (financial) assets exclude real estate + personal use assets.
    const investable = tLiquid + tDebt + tEquity + tGold;

    return {
      incomeM, incomeA, expM, expA, savingsM, ongoingM, surplusM,
      tLiquid, tDebt, tEquity, tGold, tRe, tPersonal,
      totalAssets, totalLiab, notionalNW, actualNW, investable,
      savingsRate: pctOf(savingsM, incomeM),
      expenseRatio: pctOf(expM, incomeM),
      emergencyMonths: expM > 0 ? tLiquid / expM : 0,
      leverage: pctOf(totalLiab, totalAssets),
      solvency: pctOf(notionalNW, totalAssets),
    };
  }, [income, household, lifestyle, dependent, insurance, emis, ongoing, liquid, debt, equity, gold, realEstate, personal, liabilities]);

  // Investable-asset mix (the part an MFD actually advises on).
  const mix = [
    { label: "Equity", value: m.tEquity, color: C.equity },
    { label: "Debt", value: m.tDebt, color: C.debt },
    { label: "Liquid", value: m.tLiquid, color: C.liquid },
    { label: "Gold", value: m.tGold, color: C.gold },
  ];

  // Financial-health checks (advisor value-add).
  const checks = [
    { name: "Savings rate", val: `${m.savingsRate.toFixed(0)}%`, ok: m.savingsRate >= 20, good: "Healthy savings discipline", bad: "Aim to save ≥ 20% of income" },
    { name: "Expense ratio", val: `${m.expenseRatio.toFixed(0)}%`, ok: m.expenseRatio <= 70, good: "Expenses well within income", bad: "Expenses are high vs income" },
    { name: "Emergency fund", val: `${m.emergencyMonths.toFixed(1)} mo`, ok: m.emergencyMonths >= 6, good: "6+ months of liquid cushion", bad: "Build 6 months of expenses in liquid assets" },
    { name: "Leverage (debt/assets)", val: `${m.leverage.toFixed(0)}%`, ok: m.leverage <= 40, good: "Comfortable leverage", bad: "Debt is high vs assets — deleverage" },
  ];
  const score = checks.filter((c) => c.ok).length;

  return (
    <div className="card-surface p-5 space-y-6">
      <div>
        <h2 className="text-base font-semibold">The REAL Statement — Net Worth &amp; Cashflow</h2>
        <p className="text-xs text-muted-foreground">
          A complete financial-discovery snapshot: <strong>R</strong>evenue, <strong>E</strong>xpenses, <strong>A</strong>ssets &amp; <strong>L</strong>iabilities — with
          savings surplus, net worth (Notional &amp; Actual) and key health ratios. Enter monthly amounts for income &amp; expenses; present values for assets.
        </p>
      </div>

      {/* ── Headline ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total income (annual)" value={inr(m.incomeA)} tone="cyan" />
        <Stat label="Surplus for new investments" value={`${inr(m.surplusM)}/mo`} tone={m.surplusM >= 0 ? "emerald" : "rose"} />
        <Stat label="Notional net worth" value={inr(m.notionalNW)} tone="emerald" />
        <Stat label="Actual net worth" value={inr(m.actualNW)} tone="emerald" />
      </div>

      {/* ── Income ── */}
      <Section n="R" title="Revenue (Income)">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {INCOME_FIELDS.map((f) => (
            <Field key={f.key} label={f.label + " (₹/mo)"}>
              <input
                type="number" min={0} value={income[f.key] ?? 0}
                onChange={(e) => setIncome({ ...income, [f.key]: Math.max(0, Number(e.target.value) || 0) })}
                className="input-base text-sm w-full"
              />
            </Field>
          ))}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Total income: <strong>{inr(m.incomeM)}/mo</strong> · <strong>{inr(m.incomeA)}/yr</strong>
        </div>
      </Section>

      {/* ── Expenses ── */}
      <Section n="E" title="Expenses">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <GroupEditor title="Household" fields={HOUSEHOLD} values={household} setValues={setHousehold} color={C.household} suffix="/mo" />
          <GroupEditor title="Lifestyle" fields={LIFESTYLE} values={lifestyle} setValues={setLifestyle} color={C.lifestyle} suffix="/mo" />
          <GroupEditor title="Dependent" fields={DEPENDENT} values={dependent} setValues={setDependent} color={C.dependent} suffix="/mo" />
          <GroupEditor title="Insurance premiums" fields={INS_PREMIUMS} values={insurance} setValues={setInsurance} color={C.insurance} suffix="/mo" />
          <GroupEditor title="Loan EMIs" fields={LOAN_EMIS} values={emis} setValues={setEmis} color={C.emi} suffix="/mo" />
          <GroupEditor title="Ongoing investments (SIPs / RDs)" fields={ONGOING_INV} values={ongoing} setValues={setOngoing} color={C.income} suffix="/mo" />
        </div>
      </Section>

      {/* ── Savings summary ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total income" value={`${inr(m.incomeM)}/mo`} />
        <Stat label="Total expenses" value={`${inr(m.expM)}/mo`} />
        <Stat label="Total savings" value={`${inr(m.savingsM)}/mo`} tone={m.savingsM >= 0 ? "emerald" : "rose"} />
        <Stat label="Ongoing investments" value={`${inr(m.ongoingM)}/mo`} />
        <Stat label="Surplus for new SIPs" value={`${inr(m.surplusM)}/mo`} tone={m.surplusM >= 0 ? "emerald" : "rose"} />
      </div>

      {/* ── Assets ── */}
      <Section n="A" title="Assets (present value)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <GroupEditor title="Liquid assets" fields={LIQUID} values={liquid} setValues={setLiquid} color={C.liquid} />
          <GroupEditor title="Debt assets" fields={DEBT} values={debt} setValues={setDebt} color={C.debt} />
          <GroupEditor title="Equity assets" fields={EQUITY} values={equity} setValues={setEquity} color={C.equity} />
          <GroupEditor title="Gold assets" fields={GOLD} values={gold} setValues={setGold} color={C.gold} />
          <GroupEditor title="Real-estate assets" fields={REAL_ESTATE} values={realEstate} setValues={setRealEstate} color={C.realestate} />
          <GroupEditor title="Personal assets (excluded from Actual NW)" fields={PERSONAL} values={personal} setValues={setPersonal} color={C.personal} />
        </div>
        <div className="text-xs text-muted-foreground mt-2">Total assets: <strong>{inr(m.totalAssets)}</strong> · Investable (financial) assets: <strong>{inr(m.investable)}</strong></div>
      </Section>

      {/* ── Liabilities ── */}
      <Section n="L" title="Liabilities">
        <div className="md:max-w-xl">
          <GroupEditor title="Outstanding liabilities" fields={LIABILITIES} values={liabilities} setValues={setLiabilities} color={C.emi} />
        </div>
      </Section>

      {/* ── Net worth ── */}
      <div className="rounded-lg border border-border bg-secondary/20 p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Net worth</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total assets" value={inr(m.totalAssets)} />
          <Stat label="Total liabilities" value={inr(m.totalLiab)} tone={m.totalLiab > 0 ? "rose" : undefined} />
          <Stat label="Notional net worth (incl. personal)" value={inr(m.notionalNW)} tone="emerald" />
          <Stat label="Actual net worth (excl. personal)" value={inr(m.actualNW)} tone="emerald" />
        </div>
      </div>

      {/* ── Investable asset mix ── */}
      {m.investable > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Investable asset mix</div>
          <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
            {mix.filter((b) => b.value > 0).map((b, i) => {
              const pct = pctOf(b.value, m.investable);
              return (
                <div key={i} className="h-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ width: `${Math.max(3, pct)}%`, background: b.color }} title={`${b.label}: ${pct.toFixed(0)}%`}>
                  {pct >= 8 ? `${pct.toFixed(0)}%` : ""}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2 text-[11px]">
            {mix.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: b.color }} /> {b.label} {inrShort(b.value)} ({pctOf(b.value, m.investable).toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Health ratios ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Financial-health ratios</div>
          <div className="text-xs font-semibold">Score: <span className={score >= 3 ? "text-emerald-600" : score >= 2 ? "text-amber-600" : "text-rose-600"}>{score}/4</span></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 px-2 border-b border-border">Ratio</th>
                <th className="py-1.5 px-2 border-b border-border text-right">Value</th>
                <th className="py-1.5 px-2 border-b border-border">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.name}>
                  <td className="py-1.5 px-2 border-b border-border/50 font-medium">{c.name}</td>
                  <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums">{c.val}</td>
                  <td className={`py-1.5 px-2 border-b border-border/50 ${c.ok ? "text-emerald-700" : "text-rose-700"}`}>{c.ok ? `✓ ${c.good}` : `⚠ ${c.bad}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Insight tone={m.surplusM > 0 ? "emerald" : "amber"}>
        {m.surplusM > 0
          ? `This household can invest about ${inr(m.surplusM)}/month (${inr(m.surplusM * 12)}/yr) of fresh surplus.`
          : `Expenses + ongoing investments currently absorb all income — there's no fresh surplus to deploy.`}{" "}
        Actual net worth (excluding personal-use assets like the primary home, vehicles and jewellery) is <strong>{inr(m.actualNW)}</strong>,
        the figure that reflects truly investable wealth. Notional net worth including those assets is {inr(m.notionalNW)}.
      </Insight>

      <p className="text-[10px] text-muted-foreground">
        Modelled on Network FP's REAL Statement. Income/expenses are entered monthly (annualised ×12); assets &amp; liabilities are present values.
      </p>
    </div>
  );
}
