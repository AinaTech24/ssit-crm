/**
 * The calculator catalog. Each entry is a self-contained CalculatorDef (typed
 * inputs + a pure compute). The gallery and the [key] screen are generated from
 * this array — adding a calculator means adding an entry here, nothing else.
 *
 * Math is imported from the ported pure libs (goals/calc = the shared SIP/goal
 * engine; ./calc = the extended calculator engines). Formulas match the web app;
 * every compute maps this screen's inputs onto the exact function signature.
 */

import {
  fvSip, fvLumpsum, inflatedTarget, computeGoal,
} from "../goals/calc";
import {
  growingSipSchedule, costOfDelay, retirementCorpus, swpDeplete, cagrCalculate,
  monthsToTarget, fdVsEquity, rentVsBuy, emergencyFund, btid, computeEmiSip,
  computeCrashStress, computeFire, computeNps, computeChildEducation,
} from "./calc";
import { inr } from "../../lib/format";
import type { CalculatorDef } from "./types";

const compact = (n: number) => inr(Math.round(n));
const pct = (n: number) => `${n.toFixed(1)}%`;
const yrs = (n: number) => (Number.isInteger(n) ? `${n} yrs` : `${n.toFixed(1)} yrs`);

// ── SIP & wealth ──────────────────────────────────────────────────────────

const sip: CalculatorDef = {
  key: "sip", name: "SIP Calculator", group: "SIP & Wealth", icon: "trending-up",
  desc: "Future value of a monthly SIP",
  inputs: [
    { key: "monthly", label: "Monthly SIP", type: "money", default: 10000 },
    { key: "years", label: "Duration", type: "years", default: 15 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const months = v.years * 12;
    const fv = fvSip(v.monthly, v.returnPct, months);
    const invested = v.monthly * months;
    return [
      { type: "stat", label: "Projected corpus", value: compact(fv), tone: "success" },
      { type: "stat", label: "You invest", value: compact(invested), tone: "neutral" },
      { type: "stat", label: "Wealth gained", value: compact(fv - invested), tone: "brand" },
      { type: "insight", text: `A ${compact(v.monthly)}/month SIP for ${yrs(v.years)} at ${pct(v.returnPct)} grows to ${compact(fv)} — ${invested > 0 ? (fv / invested).toFixed(1) : "0"}× the money you put in.` },
    ];
  },
};

const lumpsum: CalculatorDef = {
  key: "lumpsum", name: "Lumpsum Calculator", group: "SIP & Wealth", icon: "dollar-sign",
  desc: "One-time investment growth",
  inputs: [
    { key: "amount", label: "Investment amount", type: "money", default: 500000 },
    { key: "years", label: "Duration", type: "years", default: 10 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const fv = fvLumpsum(v.amount, v.returnPct, v.years * 12);
    return [
      { type: "stat", label: "Future value", value: compact(fv), tone: "success" },
      { type: "stat", label: "Invested", value: compact(v.amount), tone: "neutral" },
      { type: "stat", label: "Gain", value: compact(fv - v.amount), tone: "brand" },
    ];
  },
};

const sipLumpsum: CalculatorDef = {
  key: "sip-lumpsum", name: "SIP + Lumpsum", group: "SIP & Wealth", icon: "layers",
  desc: "Combine a lumpsum and a monthly SIP",
  inputs: [
    { key: "lumpsum", label: "Lumpsum today", type: "money", default: 500000 },
    { key: "monthly", label: "Monthly SIP", type: "money", default: 10000 },
    { key: "years", label: "Duration", type: "years", default: 15 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const months = v.years * 12;
    const fvL = fvLumpsum(v.lumpsum, v.returnPct, months);
    const fvS = fvSip(v.monthly, v.returnPct, months);
    const invested = v.lumpsum + v.monthly * months;
    const total = fvL + fvS;
    return [
      { type: "stat", label: "Total corpus", value: compact(total), tone: "success" },
      { type: "section", text: "Split" },
      { type: "stat", label: "From lumpsum", value: compact(fvL), tone: "neutral" },
      { type: "stat", label: "From SIP", value: compact(fvS), tone: "neutral" },
      { type: "stat", label: "Wealth gained", value: compact(total - invested), tone: "brand" },
    ];
  },
};

const stepUp: CalculatorDef = {
  key: "stepup", name: "Step-up SIP", group: "SIP & Wealth", icon: "bar-chart-2",
  desc: "A SIP that grows every year vs a flat one",
  inputs: [
    { key: "monthly", label: "Starting SIP", type: "money", default: 10000 },
    { key: "years", label: "Duration", type: "years", default: 15 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
    { key: "stepUpPct", label: "Annual step-up", type: "percent", default: 10 },
  ],
  compute: (v) => {
    const s = growingSipSchedule({ monthlySip: v.monthly, annualReturnPct: v.returnPct, annualGrowthPct: v.stepUpPct, years: Math.round(v.years) });
    const flat = s.regular[s.regular.length - 1]?.fv ?? 0;
    const stepped = s.growing[s.growing.length - 1]?.fv ?? 0;
    const every = Math.max(1, Math.ceil(v.years / 6));
    const rows = s.growing
      .filter((_, i) => i % every === 0 || i === s.growing.length - 1)
      .map((g) => [`Y${g.year}`, compact(s.regular[g.year - 1]?.fv ?? 0), compact(g.fv)]);
    return [
      { type: "stat", label: `Step-up SIP (+${pct(v.stepUpPct)}/yr)`, value: compact(stepped), tone: "success" },
      { type: "stat", label: "Flat SIP", value: compact(flat), tone: "neutral" },
      { type: "stat", label: "Extra wealth from stepping up", value: compact(stepped - flat), tone: "brand" },
      { type: "section", text: "Corpus over time" },
      { type: "table", head: ["Year", "Flat", "Step-up"], rows },
    ];
  },
};

const crorepati: CalculatorDef = {
  key: "crorepati", name: "Crorepati Countdown", group: "SIP & Wealth", icon: "award",
  desc: "How long to reach a target corpus",
  inputs: [
    { key: "target", label: "Target corpus", type: "money", default: 10000000 },
    { key: "monthly", label: "Monthly SIP", type: "money", default: 25000 },
    { key: "lumpsum", label: "Lumpsum today", type: "money", default: 0 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const months = monthsToTarget({ monthlySip: v.monthly, lumpsum: v.lumpsum, annualReturnPct: v.returnPct, target: v.target });
    if (months == null) return [{ type: "insight", text: "This won't reach the target within 60 years — raise the SIP or return.", tone: "warning" }];
    const y = Math.floor(months / 12), m = months % 12;
    return [
      { type: "stat", label: `Time to ${compact(v.target)}`, value: `${y}y ${m}m`, tone: "success" },
      { type: "stat", label: "Invested by then", value: compact(v.lumpsum + v.monthly * months), tone: "neutral" },
      { type: "insight", text: `At ${compact(v.monthly)}/month and ${pct(v.returnPct)}, you cross ${compact(v.target)} in about ${y} years ${m} months.` },
    ];
  },
};

const cagr: CalculatorDef = {
  key: "cagr", name: "CAGR", group: "SIP & Wealth", icon: "activity",
  desc: "Annualised return between two values",
  inputs: [
    { key: "initial", label: "Initial value", type: "money", default: 100000 },
    { key: "final", label: "Final value", type: "money", default: 250000 },
    { key: "years", label: "Years held", type: "years", default: 5 },
  ],
  compute: (v) => {
    const r = cagrCalculate({ initialValue: v.initial, finalValue: v.final, years: v.years });
    return [
      { type: "stat", label: "CAGR", value: pct(r.cagrPct), tone: "success" },
      { type: "stat", label: "Absolute return", value: pct(r.absoluteReturnPct), tone: "neutral" },
    ];
  },
};

// ── Goals & planning ─────────────────────────────────────────────────────

const goal: CalculatorDef = {
  key: "goal", name: "Goal Planner", group: "Goals & Planning", icon: "target",
  desc: "SIP needed to reach a future goal",
  inputs: [
    { key: "presentTarget", label: "Goal cost (today)", type: "money", default: 2500000 },
    { key: "years", label: "Years to goal", type: "years", default: 10 },
    { key: "currentValue", label: "Already saved", type: "money", default: 0 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
    { key: "inflationPct", label: "Inflation", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const r = computeGoal({
      presentTarget: v.presentTarget, currentValue: v.currentValue, existingMonthlySip: 0,
      monthsLeft: v.years * 12, expectedReturnPct: v.returnPct, inflationPct: v.inflationPct,
    });
    return [
      { type: "stat", label: "Goal cost at that time", value: compact(r.futureTarget), tone: "warning", hint: `${compact(v.presentTarget)} today + ${pct(v.inflationPct)} inflation` },
      { type: "stat", label: "Monthly SIP needed", value: compact(r.requiredMonthlySipTotal), tone: "success" },
      { type: "stat", label: "Or lumpsum today", value: compact(r.requiredLumpsumToday), tone: "neutral" },
    ];
  },
};

const inflation: CalculatorDef = {
  key: "inflation", name: "Inflation Impact", group: "Goals & Planning", icon: "wind",
  desc: "What something will cost in future",
  inputs: [
    { key: "amount", label: "Cost today", type: "money", default: 100000 },
    { key: "years", label: "Years ahead", type: "years", default: 15 },
    { key: "inflationPct", label: "Inflation", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const fv = inflatedTarget(v.amount, v.inflationPct, v.years);
    return [
      { type: "stat", label: `Cost in ${v.years} years`, value: compact(fv), tone: "warning" },
      { type: "insight", text: `What costs ${compact(v.amount)} today will cost ${compact(fv)} in ${yrs(v.years)} at ${pct(v.inflationPct)} inflation.` },
    ];
  },
};

const retirement: CalculatorDef = {
  key: "retirement", name: "Retirement", group: "Goals & Planning", icon: "sunset",
  desc: "Corpus and SIP for retirement",
  inputs: [
    { key: "currentAge", label: "Current age", type: "int", default: 35 },
    { key: "retireAge", label: "Retirement age", type: "int", default: 60 },
    { key: "lifeExpectancy", label: "Life expectancy", type: "int", default: 85 },
    { key: "monthlyIncome", label: "Monthly income needed (today)", type: "money", default: 60000 },
    { key: "existingFund", label: "Already saved", type: "money", default: 0 },
    { key: "preReturnPct", label: "Return before retirement", type: "percent", default: 12 },
    { key: "postReturnPct", label: "Return after retirement", type: "percent", default: 7 },
    { key: "inflationPct", label: "Inflation", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const r = retirementCorpus({
      currentAge: v.currentAge, retirementAge: v.retireAge, lifeExpectancy: v.lifeExpectancy,
      monthlyIncomeTodayInr: v.monthlyIncome, inflationPct: v.inflationPct,
      preReturnPct: v.preReturnPct, postReturnPct: v.postReturnPct, existingFundInr: v.existingFund,
    });
    return [
      { type: "stat", label: "Corpus needed at retirement", value: compact(r.corpusRequired), tone: "warning" },
      { type: "stat", label: "Monthly SIP from now", value: compact(r.monthlySavingsRequired), tone: "success" },
      { type: "stat", label: "Monthly income at retirement", value: compact(r.monthlyIncomeAtRetirement), tone: "neutral", hint: "inflation-adjusted" },
    ];
  },
};

const childEdu: CalculatorDef = {
  key: "child-education", name: "Child Education", group: "Goals & Planning", icon: "book-open",
  desc: "Fund a child's education goal",
  inputs: [
    { key: "childAge", label: "Child's age now", type: "int", default: 3 },
    { key: "goalAge", label: "Age at admission", type: "int", default: 18 },
    { key: "costToday", label: "Education cost (today)", type: "money", default: 2000000 },
    { key: "existingSavings", label: "Already saved", type: "money", default: 0 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
    { key: "eduInflationPct", label: "Education inflation", type: "percent", default: 10 },
  ],
  compute: (v) => {
    const r = computeChildEducation({
      childCurrentAge: v.childAge, eduInflationPct: v.eduInflationPct, expectedReturnPct: v.returnPct,
      existingSavings: v.existingSavings,
      milestones: [{ name: "Education", childAgeAtStart: v.goalAge, currentCost: v.costToday }],
    });
    return [
      { type: "stat", label: "Future cost", value: compact(r.totalFutureCost), tone: "warning" },
      { type: "stat", label: "Monthly SIP needed", value: compact(r.totalMonthlySip), tone: "success" },
      { type: "insight", text: `Education inflation (${pct(v.eduInflationPct)}) runs higher than general inflation — starting early is what makes the SIP affordable.` },
    ];
  },
};

const costDelay: CalculatorDef = {
  key: "cost-of-delay", name: "Cost of Delay", group: "Goals & Planning", icon: "clock",
  desc: "The price of starting late",
  inputs: [
    { key: "monthly", label: "Monthly SIP", type: "money", default: 10000 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
    { key: "startAge", label: "Your age now", type: "int", default: 30 },
    { key: "delayYears", label: "Years delayed", type: "int", default: 5 },
    { key: "endAge", label: "Invest until age", type: "int", default: 60 },
  ],
  compute: (v) => {
    const r = costOfDelay({
      sipAmount: v.monthly, returnPct: v.returnPct,
      startAgeNow: v.startAge, startAgeLater: v.startAge + v.delayYears, endAge: v.endAge,
    });
    return [
      { type: "stat", label: "If you start now", value: compact(r.now.finalValue), tone: "success" },
      { type: "stat", label: `If delayed ${v.delayYears}y`, value: compact(r.later.finalValue), tone: "neutral" },
      { type: "stat", label: "Cost of waiting", value: compact(r.costOfDelay), tone: "danger" },
      { type: "insight", text: `Delaying just ${v.delayYears} years costs ${compact(r.costOfDelay)} — the same SIP, started later, ends far smaller.`, tone: "warning" },
    ];
  },
};

// ── Income & withdrawal ────────────────────────────────────────────────────

const swp: CalculatorDef = {
  key: "swp", name: "SWP Calculator", group: "Income & Withdrawal", icon: "download",
  desc: "How long a corpus lasts with withdrawals",
  inputs: [
    { key: "corpus", label: "Corpus", type: "money", default: 5000000 },
    { key: "withdrawal", label: "Monthly withdrawal", type: "money", default: 30000 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 8 },
    { key: "years", label: "Withdraw for (yrs)", type: "years", default: 20 },
  ],
  compute: (v) => {
    const r = swpDeplete({ corpusInr: v.corpus, monthlyWithdrawalInr: v.withdrawal, returnPct: v.returnPct, years: v.years });
    const depleted = r.monthsBeforeDepletion != null;
    return [
      { type: "stat", label: "Total withdrawn", value: compact(r.totalWithdrawn), tone: "success" },
      { type: "stat", label: `Balance after ${v.years}y`, value: compact(r.finalValue), tone: depleted ? "danger" : "neutral" },
      depleted
        ? { type: "insight", text: `The corpus runs out in about ${Math.floor((r.monthsBeforeDepletion ?? 0) / 12)}y ${(r.monthsBeforeDepletion ?? 0) % 12}m — lower the withdrawal to sustain it.`, tone: "danger" }
        : { type: "insight", text: `The corpus sustains ${compact(v.withdrawal)}/month for the full ${yrs(v.years)} and still leaves ${compact(r.finalValue)}.`, tone: "success" },
    ];
  },
};

// ── Smart decisions ────────────────────────────────────────────────────────

const fdEquity: CalculatorDef = {
  key: "fd-equity", name: "FD vs Equity", group: "Smart Decisions", icon: "git-branch",
  desc: "The gap between FD and equity growth",
  inputs: [
    { key: "lumpsum", label: "Lumpsum", type: "money", default: 1000000 },
    { key: "monthlySip", label: "Monthly SIP (optional)", type: "money", default: 0 },
    { key: "years", label: "Duration", type: "years", default: 10 },
    { key: "fdRate", label: "FD rate", type: "percent", default: 6.5 },
    { key: "equityRate", label: "Equity return", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const r = fdVsEquity({ lumpsum: v.lumpsum, monthlySip: v.monthlySip, years: v.years, fdRatePct: v.fdRate, equityRatePct: v.equityRate });
    return [
      { type: "stat", label: "Equity corpus", value: compact(r.eq), tone: "success" },
      { type: "stat", label: "FD corpus", value: compact(r.fd), tone: "neutral" },
      { type: "stat", label: "Gap", value: compact(r.gap), tone: "brand" },
    ];
  },
};

const rentBuy: CalculatorDef = {
  key: "rent-buy", name: "Rent vs Buy", group: "Smart Decisions", icon: "home",
  desc: "Renting + investing vs buying a home",
  inputs: [
    { key: "homePrice", label: "Home price", type: "money", default: 10000000 },
    { key: "downPaymentPct", label: "Down payment", type: "percent", default: 20 },
    { key: "loanRatePct", label: "Home loan rate", type: "percent", default: 8.5 },
    { key: "loanYears", label: "Loan tenure", type: "years", default: 20 },
    { key: "appreciationPct", label: "Property appreciation", type: "percent", default: 7 },
    { key: "monthlyRent", label: "Monthly rent", type: "money", default: 30000 },
    { key: "rentInflationPct", label: "Rent increase/yr", type: "percent", default: 7 },
    { key: "equityReturnPct", label: "Equity return", type: "percent", default: 12 },
    { key: "years", label: "Horizon", type: "years", default: 15 },
  ],
  compute: (v) => {
    const r = rentVsBuy({
      homePrice: v.homePrice, downPaymentPct: v.downPaymentPct, loanRatePct: v.loanRatePct, loanYears: v.loanYears,
      homeAppreciationPct: v.appreciationPct, maintenancePctPerYear: 1, monthlyRent: v.monthlyRent,
      rentInflationPct: v.rentInflationPct, equityReturnPct: v.equityReturnPct, horizonYears: v.years,
    });
    return [
      { type: "stat", label: "Net worth if you BUY", value: compact(r.buyNetWorth), tone: r.winner === "buy" ? "success" : "neutral" },
      { type: "stat", label: "Net worth if you RENT + invest", value: compact(r.rentNetWorth), tone: r.winner === "rent" ? "success" : "neutral" },
      { type: "insight", text: r.winner === "buy" ? "Buying comes out ahead over this horizon." : "Renting and investing the difference comes out ahead here.", tone: "brand" },
    ];
  },
};

const emiSip: CalculatorDef = {
  key: "emi-sip", name: "EMI → SIP", group: "Smart Decisions", icon: "repeat",
  desc: "A small SIP can match a big loan repayment",
  inputs: [
    { key: "loanAmount", label: "Loan amount", type: "money", default: 3000000 },
    { key: "ratePct", label: "Loan rate", type: "percent", default: 8.5 },
    { key: "tenureYears", label: "Loan tenure", type: "years", default: 20 },
    { key: "sipReturnPct", label: "SIP return", type: "percent", default: 12 },
  ],
  compute: (v) => {
    const r = computeEmiSip({ mode: "loan", loanAmount: v.loanAmount, interestRatePct: v.ratePct, emiAmount: 0, tenureMonths: Math.round(v.tenureYears * 12), sipReturnPct: v.sipReturnPct });
    return [
      { type: "stat", label: "Monthly EMI", value: compact(r.monthlyEmi), tone: "warning" },
      { type: "stat", label: "Total repaid to bank", value: compact(r.totalRepayment), tone: "neutral" },
      { type: "stat", label: "SIP to reach the same total", value: compact(r.monthlySipRequired), tone: "success", hint: `just ${pct(r.sipAsPctOfEmi)} of the EMI` },
      { type: "insight", text: `To accumulate what you repay the bank (${compact(r.totalRepayment)}), a SIP of only ${compact(r.monthlySipRequired)}/month is enough — the power of compounding vs interest.`, tone: "brand" },
    ];
  },
};

const btidCalc: CalculatorDef = {
  key: "btid", name: "Term + MF vs ULIP", group: "Smart Decisions", icon: "shield",
  desc: "Buy-term-invest-difference vs a ULIP/endowment",
  inputs: [
    { key: "annualBudget", label: "Annual budget", type: "money", default: 100000 },
    { key: "termAnnualPremium", label: "Term plan premium/yr", type: "money", default: 15000 },
    { key: "termCover", label: "Term cover", type: "money", default: 10000000 },
    { key: "years", label: "Horizon", type: "years", default: 20 },
    { key: "mfReturnPct", label: "MF return", type: "percent", default: 12 },
    { key: "tradReturnPct", label: "ULIP/endowment return", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const r = btid({ annualBudget: v.annualBudget, termAnnualPremium: v.termAnnualPremium, termCover: v.termCover, years: v.years, mfReturnPct: v.mfReturnPct, tradReturnPct: v.tradReturnPct });
    return [
      { type: "stat", label: "Term + MF corpus", value: compact(r.btidCorpus), tone: "success", hint: `+ ${compact(r.btidCover)} life cover` },
      { type: "stat", label: "ULIP/endowment corpus", value: compact(r.tradCorpus), tone: "neutral", hint: `+ ${compact(r.tradCover)} cover` },
      { type: "stat", label: "Extra wealth", value: compact(r.wealthGap), tone: "brand" },
      { type: "insight", text: `Buying a term plan and investing the rest in MF builds ${compact(r.wealthGap)} more — with ${compact(r.coverGap)} more life cover too.` },
    ];
  },
};

// ── Essentials ─────────────────────────────────────────────────────────────

const emergency: CalculatorDef = {
  key: "emergency", name: "Emergency Fund", group: "Essentials", icon: "umbrella",
  desc: "How big your safety net should be",
  inputs: [
    { key: "monthlyExpense", label: "Monthly expense", type: "money", default: 60000 },
    { key: "monthsBuffer", label: "Months of cover", type: "int", default: 6 },
    { key: "existing", label: "Already set aside", type: "money", default: 0 },
    { key: "buildMonths", label: "Build over (months)", type: "int", default: 12 },
    { key: "parkReturnPct", label: "Parked-fund return", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const r = emergencyFund({ monthlyExpense: v.monthlyExpense, monthsBuffer: v.monthsBuffer, existing: v.existing, buildMonths: v.buildMonths, parkReturnPct: v.parkReturnPct });
    return [
      { type: "stat", label: "Target fund", value: compact(r.target), tone: "success" },
      { type: "stat", label: "Still to build", value: compact(r.gap), tone: r.gap > 0 ? "warning" : "neutral" },
      r.requiredSip > 0
        ? { type: "stat", label: `Monthly SIP for ${v.buildMonths} months`, value: compact(r.requiredSip), tone: "brand" }
        : { type: "insight", text: "You're already covered — well done.", tone: "success" },
    ];
  },
};

const fire: CalculatorDef = {
  key: "fire", name: "FIRE Number", group: "Essentials", icon: "zap",
  desc: "Corpus for financial independence",
  inputs: [
    { key: "monthlyExpense", label: "Monthly expense (today)", type: "money", default: 80000 },
    { key: "currentAge", label: "Current age", type: "int", default: 32 },
    { key: "lifeExpectancy", label: "Life expectancy", type: "int", default: 85 },
    { key: "currentCorpus", label: "Current corpus", type: "money", default: 1000000 },
    { key: "monthly", label: "Monthly SIP", type: "money", default: 50000 },
    { key: "stepUpPct", label: "Annual SIP step-up", type: "percent", default: 0 },
    { key: "preReturnPct", label: "Return (accumulating)", type: "percent", default: 12 },
    { key: "postReturnPct", label: "Return (retired)", type: "percent", default: 7 },
    { key: "inflationPct", label: "Inflation", type: "percent", default: 6 },
    { key: "swrPct", label: "Safe withdrawal rate", type: "percent", default: 4 },
  ],
  compute: (v) => {
    const r = computeFire({
      currentAge: v.currentAge, monthlyExpenseNow: v.monthlyExpense, inflationPct: v.inflationPct,
      preReturnPct: v.preReturnPct, postReturnPct: v.postReturnPct, currentCorpus: v.currentCorpus,
      monthlySip: v.monthly, sipStepUpPct: v.stepUpPct, swrPct: v.swrPct, lifeExpectancy: v.lifeExpectancy,
    });
    const out: any[] = [
      { type: "stat", label: "FIRE number (today's value)", value: compact(r.fireNumberToday), tone: "warning" },
    ];
    if (r.fireAge != null) {
      out.push({ type: "stat", label: "You reach FIRE at age", value: String(r.fireAge), tone: "success", hint: r.yearsToFire != null ? `in ${r.yearsToFire} years` : undefined });
      out.push({ type: "insight", text: r.sustainsToLifeExpectancy ? `The corpus sustains your expenses to age ${v.lifeExpectancy}.` : `Careful — the corpus may run short around age ${r.shortfallAge}. Raise the SIP or trim the withdrawal.`, tone: r.sustainsToLifeExpectancy ? "success" : "warning" });
    } else {
      out.push({ type: "insight", text: "This plan doesn't reach FIRE within your life expectancy — raise the SIP or lower expenses.", tone: "danger" });
    }
    return out;
  },
};

const nps: CalculatorDef = {
  key: "nps", name: "NPS Retirement", group: "Essentials", icon: "briefcase",
  desc: "NPS corpus, pension and tax benefit",
  inputs: [
    { key: "monthly", label: "Monthly contribution", type: "money", default: 5000 },
    { key: "stepUpPct", label: "Annual step-up", type: "percent", default: 0 },
    { key: "currentAge", label: "Current age", type: "int", default: 30 },
    { key: "retireAge", label: "Retirement age", type: "int", default: 60 },
    { key: "existingCorpus", label: "Existing NPS corpus", type: "money", default: 0 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 10 },
    { key: "annuityRatePct", label: "Annuity rate", type: "percent", default: 6 },
    { key: "annuityPortionPct", label: "% to annuity (min 40)", type: "percent", default: 40 },
    { key: "taxSlabPct", label: "Your tax slab", type: "percent", default: 30 },
  ],
  compute: (v) => {
    const r = computeNps({
      currentAge: v.currentAge, retirementAge: v.retireAge, monthlyContribution: v.monthly,
      annualStepUpPct: v.stepUpPct, expectedReturnPct: v.returnPct, existingCorpus: v.existingCorpus,
      annuityPortionPct: v.annuityPortionPct, annuityRatePct: v.annuityRatePct, taxSlabPct: v.taxSlabPct,
    });
    return [
      { type: "stat", label: "Corpus at retirement", value: compact(r.corpus), tone: "success" },
      { type: "stat", label: "Lumpsum (tax-free)", value: compact(r.lumpSum), tone: "neutral" },
      { type: "stat", label: "Monthly pension", value: compact(r.monthlyPension), tone: "brand" },
      { type: "insight", text: `Plus about ${compact(r.annual80CCD1BBenefit)}/yr saved in tax under 80CCD(1B).` },
    ];
  },
};

const crash: CalculatorDef = {
  key: "crash", name: "Market Crash Test", group: "Essentials", icon: "trending-down",
  desc: "Staying invested vs panic-selling",
  inputs: [
    { key: "monthly", label: "Monthly SIP", type: "money", default: 20000 },
    { key: "lumpsum", label: "Lumpsum", type: "money", default: 0 },
    { key: "years", label: "Duration", type: "years", default: 15 },
    { key: "returnPct", label: "Expected return", type: "percent", default: 12 },
    { key: "crashPct", label: "Crash size", type: "percent", default: 30 },
    { key: "crashYear", label: "Crash in year", type: "int", default: 5 },
    { key: "fdRatePct", label: "Panic-parked FD rate", type: "percent", default: 6 },
  ],
  compute: (v) => {
    const r = computeCrashStress({
      monthlySip: v.monthly, lumpsum: v.lumpsum, years: v.years, expectedReturnPct: v.returnPct,
      crashYear: v.crashYear, crashPct: v.crashPct, fdRatePct: v.fdRatePct,
    });
    return [
      { type: "stat", label: "If you STAY invested", value: compact(r.finalStay), tone: "success" },
      { type: "stat", label: "If you PANIC-SELL", value: compact(r.finalPanic), tone: "danger" },
      { type: "stat", label: "Cost of panic", value: compact(r.costOfPanic), tone: "warning" },
      { type: "insight", text: `A ${pct(v.crashPct)} crash in year ${v.crashYear} feels scary, but selling locks in the loss — staying invested ends ${compact(r.costOfPanic)} richer.`, tone: "brand" },
    ];
  },
};

export const CALCULATORS: CalculatorDef[] = [
  sip, lumpsum, sipLumpsum, stepUp, crorepati, cagr,
  goal, inflation, retirement, childEdu, costDelay,
  swp, fdEquity, rentBuy, emiSip, btidCalc,
  emergency, fire, nps, crash,
];

export const CALC_GROUPS: string[] = [
  "SIP & Wealth", "Goals & Planning", "Income & Withdrawal", "Smart Decisions", "Essentials",
];

export const calcByKey = (key: string): CalculatorDef | undefined => CALCULATORS.find((c) => c.key === key);
