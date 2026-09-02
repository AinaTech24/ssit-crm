/**
 * Math for the investor-facing "conversion" calculators — the persuasion tools
 * an MFD screen-shares in a meeting to create urgency and desire. Pure
 * functions, reusing the verified goal-planning helpers (fvSip is an
 * annuity-due monthly compounder; fvLumpsum compounds monthly).
 */

import { fvSip, fvLumpsum, inflatedTarget, requiredSip } from "@/lib/goal-planning/calc";

/** Months until (lumpsum grown + SIP) first reaches `target`. null if never within maxYears. */
export function monthsToTarget(p: {
  monthlySip: number;
  lumpsum: number;
  annualReturnPct: number;
  target: number;
  maxYears?: number;
}): number | null {
  if (p.target <= 0) return 0;
  const max = Math.round((p.maxYears ?? 60) * 12);
  for (let m = 0; m <= max; m++) {
    const fv = fvLumpsum(p.lumpsum, p.annualReturnPct, m) + fvSip(p.monthlySip, p.annualReturnPct, m);
    if (fv >= p.target) return m;
  }
  return null;
}

/** A future date `months` from `from`, as {label, year}. */
export function dateAfterMonths(from: Date, months: number): { label: string; iso: string } {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return { label, iso: d.toISOString().slice(0, 10) };
}

/* ── 2. Small Habit, Big Corpus (Latte Factor) ── */
export function habitToCorpus(p: {
  monthlyAmount: number;
  annualReturnPct: number;
  years: number;
}): { monthly: number; corpus: number; spent: number; gain: number } {
  const months = Math.round(p.years * 12);
  const corpus = fvSip(p.monthlyAmount, p.annualReturnPct, months);
  const spent = p.monthlyAmount * months;
  return { monthly: p.monthlyAmount, corpus, spent, gain: corpus - spent };
}

/* ── 3. Rent vs Buy + Invest the Difference ── */
export function rentVsBuy(p: {
  homePrice: number;
  downPaymentPct: number;
  loanRatePct: number;
  loanYears: number;
  homeAppreciationPct: number;
  maintenancePctPerYear: number;
  monthlyRent: number;
  rentInflationPct: number;
  equityReturnPct: number;
  horizonYears: number;
}) {
  const down = (p.homePrice * p.downPaymentPct) / 100;
  const loan = Math.max(0, p.homePrice - down);
  const r = p.loanRatePct / 100 / 12;
  const n = Math.round(p.loanYears * 12);
  const emi = n === 0 ? 0 : r === 0 ? loan / n : (loan * r) / (1 - Math.pow(1 + r, -n));
  const Hm = Math.round(p.horizonYears * 12);

  // BUY — net worth = appreciated home value − outstanding loan.
  const homeValue = p.homePrice * Math.pow(1 + p.homeAppreciationPct / 100, p.horizonYears);
  let bal = loan;
  const monthsPaid = Math.min(Hm, n);
  for (let m = 0; m < monthsPaid; m++) {
    const interest = bal * r;
    bal = bal - (emi - interest);
  }
  const outstanding = Hm >= n ? 0 : Math.max(0, bal);
  const buyNetWorth = homeValue - outstanding;

  // RENT + INVEST the difference — invest the down-payment as a lumpsum, then
  // each month invest whatever the owner spends above the renter (EMI +
  // maintenance − rent). Rent escalates annually.
  const eqM = p.equityReturnPct / 100 / 12;
  const maintenanceMonthly = (p.homePrice * (p.maintenancePctPerYear / 100)) / 12;
  let invest = down;
  let rent = p.monthlyRent;
  const buySeries: { year: number; value: number }[] = [{ year: 0, value: down }];
  const rentSeries: { year: number; value: number }[] = [{ year: 0, value: down }];
  let runBal = loan;
  for (let m = 0; m < Hm; m++) {
    if (m > 0 && m % 12 === 0) rent = rent * (1 + p.rentInflationPct / 100);
    const ownerOutflow = (m < n ? emi : 0) + maintenanceMonthly;
    const surplus = ownerOutflow - rent;
    invest = invest * (1 + eqM) + (surplus > 0 ? surplus : 0);
    // track owner equity over time for the chart
    if (m < n) {
      const interest = runBal * r;
      runBal = runBal - (emi - interest);
    }
    if ((m + 1) % 12 === 0) {
      const yr = (m + 1) / 12;
      const hv = p.homePrice * Math.pow(1 + p.homeAppreciationPct / 100, yr);
      buySeries.push({ year: yr, value: hv - Math.max(0, runBal) });
      rentSeries.push({ year: yr, value: invest });
    }
  }
  const rentNetWorth = invest;
  return {
    emi,
    homeValue,
    outstanding,
    buyNetWorth,
    rentNetWorth,
    maintenanceMonthly,
    winner: buyNetWorth >= rentNetWorth ? ("buy" as const) : ("rent" as const),
    buySeries,
    rentSeries,
  };
}

/* ── 4. FD vs Equity Wealth Gap ── */
export function fdVsEquity(p: {
  lumpsum: number;
  monthlySip: number;
  years: number;
  fdRatePct: number;
  equityRatePct: number;
}) {
  const months = Math.round(p.years * 12);
  const at = (rate: number, m: number) => fvLumpsum(p.lumpsum, rate, m) + fvSip(p.monthlySip, rate, m);
  const invested = p.lumpsum + p.monthlySip * months;
  const series: { year: number; fd: number; eq: number }[] = [];
  for (let y = 0; y <= p.years; y++) {
    const m = y * 12;
    series.push({ year: y, fd: at(p.fdRatePct, m), eq: at(p.equityRatePct, m) });
  }
  const fd = at(p.fdRatePct, months);
  const eq = at(p.equityRatePct, months);
  return { fd, eq, gap: eq - fd, invested, series };
}

/* ── 5. Child's Dream Funder ── */
export function childGoal(p: {
  childAgeNow: number;
  goalAge: number;
  costToday: number;
  eduInflationPct: number;
  existingSavings: number;
  equityReturnPct: number;
}) {
  const years = Math.max(0, p.goalAge - p.childAgeNow);
  const futureCost = inflatedTarget(p.costToday, p.eduInflationPct, years);
  const months = Math.round(years * 12);
  const sip = months > 0 ? requiredSip(futureCost, p.existingSavings, p.equityReturnPct, months) : 0;
  const fvExisting = fvLumpsum(p.existingSavings, p.equityReturnPct, months);
  return { years, futureCost, requiredSip: Math.max(0, sip), months, fvExisting };
}

/* ── 6. Inflation Lifestyle Shock ── */
export function lifestyleShock(p: {
  monthlyExpenseToday: number;
  inflationPct: number;
  yearsToRetire: number;
  retirementYears: number;
  postReturnPct: number;
}) {
  const futureMonthly = inflatedTarget(p.monthlyExpenseToday, p.inflationPct, p.yearsToRetire);
  const annualAtRetire = futureMonthly * 12;
  const r = p.postReturnPct / 100;
  const infl = p.inflationPct / 100;
  const realRate = (1 + r) / (1 + infl) - 1;
  const n = p.retirementYears;
  const corpusNeeded =
    realRate === 0
      ? annualAtRetire * n
      : annualAtRetire * (1 + realRate) * ((1 - Math.pow(1 + realRate, -n)) / realRate);
  return {
    futureMonthly,
    todayMonthly: p.monthlyExpenseToday,
    corpusNeeded,
    multiple: p.monthlyExpenseToday > 0 ? futureMonthly / p.monthlyExpenseToday : 0,
  };
}

/* ── 7. Will My Money Last? ── */
export function moneyLast(p: {
  corpus: number;
  currentAge: number;
  monthlyWithdrawal: number;
  annualReturnPct: number;
  withdrawalInflationPct: number;
  lifeExpectancy: number;
}) {
  let bal = p.corpus;
  let w = p.monthlyWithdrawal;
  const r = p.annualReturnPct / 100 / 12;
  const g = p.withdrawalInflationPct / 100;
  let months = 0;
  const maxMonths = Math.round((Math.max(p.lifeExpectancy, 100) - p.currentAge + 5) * 12);
  const series: { age: number; balance: number }[] = [{ age: p.currentAge, balance: bal }];
  // Year-by-year ledger: opening balance, total withdrawn that year, growth
  // earned, and the balance left after the year's withdrawals.
  const schedule: { age: number; opening: number; withdrawn: number; growth: number; balance: number }[] = [];
  let yearOpening = bal;
  let yearWithdrawn = 0;
  while (bal > 0 && months < maxMonths) {
    if (months > 0 && months % 12 === 0) w = w * (1 + g);
    yearWithdrawn += Math.min(w, Math.max(0, bal)); // don't count more than is left
    bal = (bal - w) * (1 + r);
    months++;
    if (months % 12 === 0) {
      const closing = Math.max(0, bal);
      series.push({ age: p.currentAge + months / 12, balance: closing });
      schedule.push({
        age: p.currentAge + months / 12,
        opening: yearOpening,
        withdrawn: yearWithdrawn,
        growth: closing - yearOpening + yearWithdrawn,
        balance: closing,
      });
      yearOpening = closing;
      yearWithdrawn = 0;
    }
  }
  // Capture the final partial year if the corpus ran dry mid-year.
  if (months % 12 !== 0) {
    const closing = Math.max(0, bal);
    schedule.push({
      age: p.currentAge + months / 12,
      opening: yearOpening,
      withdrawn: yearWithdrawn,
      growth: closing - yearOpening + yearWithdrawn,
      balance: closing,
    });
  }
  const ranOut = bal <= 0 && months < maxMonths;
  const runsOutAge = ranOut ? p.currentAge + months / 12 : null;
  const lastsForLife = runsOutAge === null || runsOutAge >= p.lifeExpectancy;
  return { runsOutAge, lastsForLife, series, schedule, yearsLasted: months / 12 };
}

/* ── 8. ₹1 Crore Race ── */
export function croreRace(p: {
  sipAmounts: number[];
  lumpsum: number;
  annualReturnPct: number;
  target: number;
}) {
  return p.sipAmounts.map((sip) => ({
    sip,
    months: monthsToTarget({
      monthlySip: sip,
      lumpsum: p.lumpsum,
      annualReturnPct: p.annualReturnPct,
      target: p.target,
    }),
  }));
}
